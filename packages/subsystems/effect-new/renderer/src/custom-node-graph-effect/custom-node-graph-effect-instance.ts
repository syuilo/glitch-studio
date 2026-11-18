import { textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectConnection, CustomNodeGraphEffectNode } from '@gs/subsystems_effect-new_shared/custom-node-graph-effect/types.ts';
import type { EffectInstance, EffectInstanceOptions } from '../effect-instance.ts';

type NodeEvaluation = {
	node: CustomNodeGraphEffectNode;
	instance: EffectInstance;
	parameters: Set<string>;
	outputs: Set<string>;
};

export function createCustomNodeGraphEffectInstance(
	definition: CustomNodeGraphEffect,
	options: EffectInstanceOptions,
	createNodeInstance: (node: CustomNodeGraphEffectNode, getInputResolution: EffectInstanceOptions['getInputResolution']) => EffectInstance,
): EffectInstance {
	const nodes = new Map(definition.nodes.map(node => [node.id, node]));
	const instances = new Map<string, EffectInstance>();
	let disposed = false;

	function connectionResolution(connection: CustomNodeGraphEffectConnection) {
		return connection.inputSource === 'publicParameter'
			? options.getInputResolution(connection.parameterId)
			: getInstance(nodes.get(connection.nodeId)!).getOutputResolution(connection.outputPort);
	}

	function getInstance(node: CustomNodeGraphEffectNode): EffectInstance {
		let instance = instances.get(node.id);
		if (instance == null) {
			instance = createNodeInstance(node, id => {
				if (!Object.hasOwn(node.params, id)) return null;
				const binding = node.params[id];
				return binding.inputSource === 'literal' ? null : connectionResolution(binding);
			});
			instances.set(node.id, instance);
		}
		return instance;
	}

	function plan(requestedOutputs: ReadonlySet<string>) {
		const evaluations = new Map<string, NodeEvaluation>();
		const publicParameters = new Set<string>();

		function requireConnection(connection: CustomNodeGraphEffectConnection): void {
			if (connection.inputSource === 'publicParameter') {
				publicParameters.add(connection.parameterId);
				return;
			}
			const node = nodes.get(connection.nodeId)!;
			let evaluation = evaluations.get(node.id);
			if (evaluation == null) {
				evaluation = { node, instance: getInstance(node), parameters: new Set(), outputs: new Set() };
				evaluations.set(node.id, evaluation);
			}
			if (evaluation.outputs.has(connection.outputPort)) return;
			evaluation.outputs.add(connection.outputPort);
			const required = evaluation.instance.getRequiredParameterIds?.(connection.outputPort) ?? Object.keys(node.params);
			for (const id of required) {
				if (evaluation.parameters.has(id) || !Object.hasOwn(node.params, id)) continue;
				evaluation.parameters.add(id);
				const binding = node.params[id];
				if (binding.inputSource !== 'literal') requireConnection(binding);
			}
		}

		for (const id of requestedOutputs) {
			if (Object.hasOwn(definition.outputs, id)) requireConnection(definition.outputs[id]);
		}

		// 後から要求された副出力が追加の依存を持つことがある。全ポートの要求を集約してから
		// 描画順を確定し、同じ配置の履歴やGPU出力を1回の評価内で二度更新しない。
		const visited = new Set<string>();
		const steps: NodeEvaluation[] = [];

		function order(evaluation: NodeEvaluation): void {
			if (visited.has(evaluation.node.id)) return;
			visited.add(evaluation.node.id);
			for (const id of evaluation.parameters) {
				const binding = evaluation.node.params[id];
				if (binding.inputSource === 'node') order(evaluations.get(binding.nodeId)!);
			}
			steps.push(evaluation);
		}

		for (const evaluation of evaluations.values()) order(evaluation);
		return { steps, publicParameters, outputIds: new Set(requestedOutputs) };
	}

	const requiredParametersByOutput = new Map<string, ReadonlySet<string>>();
	let lastPlan: ReturnType<typeof plan> | null = null;
	return {
		getRequiredParameterIds(id) {
			let required = requiredParametersByOutput.get(id);
			if (required == null) {
				required = plan(new Set([id])).publicParameters;
				requiredParametersByOutput.set(id, required);
			}
			return required;
		},
		getOutputResolution: id => Object.hasOwn(definition.outputs, id) ? connectionResolution(definition.outputs[id]) : null,
		async render(request) {
			const requested = request.requestedOutputIds;
			if (lastPlan == null || requested.size !== lastPlan.outputIds.size || !lastPlan.outputIds.isSubsetOf(requested)) {
				lastPlan = plan(requested);
			}
			const nodeOutputs = new Map<string, ReadonlyMap<string, UniformOrTexture>>();
			const read = (connection: CustomNodeGraphEffectConnection) => connection.inputSource === 'publicParameter'
				? request.params[connection.parameterId] : nodeOutputs.get(connection.nodeId)?.get(connection.outputPort);
			for (const { node, instance, parameters, outputs } of lastPlan.steps) {
				const params: Record<string, unknown> = Object.create(null);
				for (const id of parameters) {
					const binding = node.params[id];
					if (binding.inputSource === 'literal') {
						params[id] = binding.value;
					} else {
						const value = read(binding);
						// 未配線の子出力は受け手の既定値へ戻る。明示されたnullリテラルは値として保つ。
						if (value === undefined) continue;
						params[id] = binding.sampling != null && value != null && typeof value === 'object' && 'texture' in value
							? textureShaderInput((value as Extract<UniformOrTexture, { kind: 'texture' }>).texture, binding.sampling)
							: value;
					}
				}
				nodeOutputs.set(node.id, await instance.render({ ...request, params, requestedOutputIds: outputs }));
				if (disposed) throw new Error('Custom Node Graph Effect was disposed during rendering');
			}
			const result = new Map<string, UniformOrTexture>();
			for (const id of requested) {
				if (!Object.hasOwn(definition.outputs, id)) continue;
				// 公開出力には空間入力または子の出力だけを接続できることを、編集時に検証済み。
				const value = read(definition.outputs[id]) as UniformOrTexture | undefined;
				if (value != null) result.set(id, value);
			}
			return result;
		},
		dispose() {
			disposed = true;
			for (const instance of instances.values()) instance.dispose();
			instances.clear();
			requiredParametersByOutput.clear();
			lastPlan = null;
		},
	};
}
