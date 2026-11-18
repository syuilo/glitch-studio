import { createResolutionExpressionVariables } from '@gs/shared/expression/resolution-variables.ts';
import { constantShaderInput, toShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInput, ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParameterEvaluationScope } from '@gs/shared/parameter/parameter-evaluation-scope.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { EffectDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectNode, EffectReference, GraphOutputBinding } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import { resolveEffectParameterValue } from '../effect-parameters.ts';
import type { EffectPlacementOptions, EffectRenderInstance, EffectRenderRequest } from '../effect-render-instance.ts';
import { createRenderPlan, isExpressionPublicParameter } from './render-plan.ts';
import type { NodePlacement } from './render-plan.ts';

const defaultSampling: ShaderInputSampling = { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' };

function forwardPublicParameter(value: unknown, source: ParameterDefinition, target: ParameterDefinition, sampling?: ShaderInputSampling): unknown {
	if (target.canNode !== true) return value;
	// 色は元の型で一度だけ乗算する。any経由でも、スカラー・ベクトルの不足成分はテクスチャと同じ値にする。
	const spatial = source.canNode === true ? value as ShaderInput : constantShaderInput(source.dataType.kind, value);
	if (sampling == null && source.dataType.kind === target.dataType.kind) return spatial;
	// 公開入力は親のsamplingを受け継ぎ、内部の配線が明示したときだけ上書きする。
	return toShaderInput(spatial, sampling ?? (spatial.kind === 'texture' ? spatial : defaultSampling));
}

function createNodeScope(customNodeGraphEffect: CustomNodeGraphEffect, expressionParameterIds: ReadonlySet<string>, request: EffectRenderRequest, resolution: Resolution): ParameterEvaluationScope {
	const endTime = request.endTime ?? Infinity;
	return {
		time: request.time * 1000,
		endTime: endTime * 1000,
		automationGraphs: customNodeGraphEffect.automationGraphs ?? [],
		variables: {
			TIME: request.time, TIME_MS: request.time * 1000, END_TIME: endTime, END_TIME_MS: endTime * 1000,
			...createResolutionExpressionVariables(resolution),
		},
		functions: {
			PUBLIC(...args) {
				const id = args[0];
				if (args.length !== 1 || typeof id !== 'string') throw new Error('PUBLIC requires a public parameter ID');
				if (!expressionParameterIds.has(id) || !request.parameters.has(id)) {
					throw new Error(`Unavailable Custom Node Graph Effect public parameter: ${id}`);
				}
				return structuredClone(request.parameters.get(id));
			},
		},
	};
}

/** 呼び出し前にEffectCatalogで参照・配線を検証する。子インスタンスは、この配置だけが所有する。 */
export function createCustomNodeGraphEffectRenderInstance(customNodeGraphEffect: CustomNodeGraphEffect, options: EffectPlacementOptions,
	getDefinition: (source: EffectReference) => EffectDefinition,
	createChild: (source: EffectReference, options: EffectPlacementOptions) => EffectRenderInstance): EffectRenderInstance {
	const nodes = new Map(customNodeGraphEffect.nodes.map(node => [node.id, node]));
	const expressionParameterIds = new Set(Object.keys(customNodeGraphEffect.paramDefs).filter(id => isExpressionPublicParameter(customNodeGraphEffect.paramDefs[id])));
	const placements = new Map<string, NodePlacement>();
	const placementsInDependencyOrder: NodePlacement[] = [];
	let destroyed = false;
	let lastPlan: { outputIds: Set<string>; plan: ReturnType<typeof createRenderPlan> } | null = null;

	function getSourceResolution(source: GraphOutputBinding): Resolution | null {
		if (source.type === 'publicParameter') return options.inputResolutions?.get(source.parameterId) ?? null;
		return placements.get(source.nodeId)!.instance.getOutputResolution(source.outputId);
	}

	function placeNode(node: CustomNodeGraphEffectNode): void {
		if (placements.has(node.id)) return;
		const inputResolutions = new Map<string, Resolution | null>();
		for (const [parameterId, binding] of Object.entries(node.params)) {
			if (binding.type === 'value') continue;
			if (binding.type === 'nodeOutput') placeNode(nodes.get(binding.nodeId)!);
			inputResolutions.set(parameterId, getSourceResolution(binding));
		}
		const resolution = node.resolution ?? options.resolution;
		const definition = getDefinition(node.effect);
		const instance = createChild(node.effect, { resolution, inputResolutions });
		const placement = { node, definition, resolution, instance };
		placements.set(node.id, placement);
		placementsInDependencyOrder.push(placement);
	}

	function destroy(): void {
		if (destroyed) return;
		destroyed = true;
		// 入力テクスチャを借用している子を、そのテクスチャを所有する上流の子より先に破棄する。
		for (const placement of placementsInDependencyOrder.reverse()) placement.instance.destroy();
		placementsInDependencyOrder.length = 0;
		placements.clear();
		lastPlan = null;
	}

	try {
		for (const node of customNodeGraphEffect.nodes) placeNode(node);
	} catch (error) {
		destroy();
		throw error;
	}

	function getPlan(outputIds: ReadonlySet<string>) {
		if (destroyed) throw new Error('Custom Node Graph Effect instance was destroyed');
		if (lastPlan != null && outputIds.size === lastPlan.outputIds.size && lastPlan.outputIds.isSubsetOf(outputIds)) return lastPlan.plan;
		const plan = createRenderPlan(customNodeGraphEffect, placementsInDependencyOrder, expressionParameterIds, outputIds);
		lastPlan = { outputIds: new Set(outputIds), plan };
		return plan;
	}

	return {
		getRequiredParameterIds: outputIds => getPlan(outputIds).requiredParameters,
		getOutputResolution(outputId) {
			if (destroyed) throw new Error('Custom Node Graph Effect instance was destroyed');
			if (!Object.hasOwn(customNodeGraphEffect.outputs, outputId)) return null;
			const resolution = getSourceResolution(customNodeGraphEffect.outputs[outputId]);
			return resolution == null ? null : { ...resolution };
		},
		async prepare(outputIds) {
			await Promise.all(getPlan(outputIds).steps.map(({ placement, outputIds: ports }) => placement.instance.prepare?.(ports)));
		},
		render(request) {
			const nodeResults = new Map<string, ReadonlyMap<string, UniformOrTexture>>();
			for (const { placement, outputIds, parameterIds } of getPlan(request.outputIds).steps) {
				const parameters = new Map<string, unknown>();
				// 配置の引数は親の公開値と、そのノード自身の寸法で評価する。
				// 子グラフ内部のPUBLICは、子が改めて自身の引数から構成する。
				const childRequest = { ...request, outputIds, parameters, parameterScope: createNodeScope(customNodeGraphEffect, expressionParameterIds, request, placement.resolution) };
				for (const id of parameterIds) {
					if (!Object.hasOwn(placement.node.params, id)) continue;
					const binding = placement.node.params[id];
					const definition = placement.definition.paramDefs[id];
					if (binding.type === 'value') {
						parameters.set(id, resolveEffectParameterValue(definition, binding.binding, childRequest));
					} else if (binding.type === 'nodeOutput') {
						const value = nodeResults.get(binding.nodeId)!.get(binding.outputId);
						if (value != null) parameters.set(id, toShaderInput(value, binding.sampling ?? defaultSampling));
					} else {
						parameters.set(id, forwardPublicParameter(request.parameters.get(binding.parameterId),
							customNodeGraphEffect.paramDefs[binding.parameterId], definition, binding.sampling));
					}
				}
				nodeResults.set(placement.node.id, placement.instance.render(childRequest));
			}
			const outputs = new Map<string, UniformOrTexture>();
			for (const id of request.outputIds) {
				if (!Object.hasOwn(customNodeGraphEffect.outputs, id)) continue;
				const source = customNodeGraphEffect.outputs[id];
				const value = source.type === 'nodeOutput' ? nodeResults.get(source.nodeId)!.get(source.outputId) : request.parameters.get(source.parameterId) as ShaderInput;
				if (value == null) continue;
				if (value.kind === 'texture') outputs.set(id, { kind: 'texture', texture: value.texture });
				else {
					// r/rg相当のuniformも汎用・色ポートではtextureLoadの欠落成分 (0, 0, 1) と揃える。
					const kind = customNodeGraphEffect.outputDefs[id].dataType.kind;
					outputs.set(id, (kind === 'any' || kind === 'color') && value.value.length < 4 ? toShaderInput(value, defaultSampling) : value);
				}
			}
			return outputs;
		},
		resetRenderHistory() {
			for (const placement of placementsInDependencyOrder) placement.instance.resetRenderHistory();
		},
		destroy,
	};
}
