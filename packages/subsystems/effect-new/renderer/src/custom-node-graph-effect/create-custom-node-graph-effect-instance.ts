import { constantShaderInput, toShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { mapParameterTree } from '@gs/shared/parameter/parameter-tree.ts';
import { getCustomNodeGraphEffectNodeConnections } from '@gs/subsystems_effect-new_shared/custom-node-graph-effect/custom-node-graph-effect.ts';
import type { DataType } from '@gs/shared/data-type/data-type.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectConnection, CustomNodeGraphEffectNode, CustomNodeGraphEffectParameterBinding } from '@gs/subsystems_effect-new_shared/custom-node-graph-effect/custom-node-graph-effect.ts';
import type { EffectDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import type { EffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { EffectInputKind, EffectInstance, EffectInstanceOptions, EffectRenderContext } from '../effect-instance.ts';

const defaultSampling: ShaderInputSampling = { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' };
type NodeOutputs = ReadonlyMap<string, UniformOrTexture>;
type ParameterReader = (publicValues: EffectRenderContext['params'], nodeOutputs: ReadonlyMap<string, NodeOutputs>) => unknown;
type PlannedParameter = { id: string; inputKind: EffectInputKind; read: ParameterReader };
type PlannedNode = {
	node: CustomNodeGraphEffectNode;
	definition: EffectDefinition;
	connections: { parameterId: string; connection: CustomNodeGraphEffectConnection }[];
};

function readConnectedInput(value: UniformOrTexture, destination: DataType, sampling = defaultSampling) {
	// 同じ型の定数は、公開入力をいくつ経由しても元の成分を維持する。
	// any等から不足成分を読む場合だけ、テクスチャのサンプリングと同じ既定成分で補う。
	const channels = destination.kind === 'scalar' ? 1 : destination.kind === 'vector' ? 2 : 4;
	return value.kind === 'uniform' && value.value.length >= channels ? value : toShaderInput(value, sampling);
}

function planParameters(graph: CustomNodeGraphEffect, child: PlannedNode, connectionKind: (connection: CustomNodeGraphEffectConnection) => UniformOrTexture['kind'] | null): PlannedParameter[] {
	const connectedParameters = new Set(child.connections.map(({ parameterId }) => parameterId));
	return Object.entries(child.definition.paramDefs).map(([id, parameter]) => {
		const saved = (Object.hasOwn(child.node.params, id) ? child.node.params[id] : parameter.defaultValue) as CustomNodeGraphEffectParameterBinding;
		// 定義の既定値・配置の値とも、編集時に検証した同じBindingのツリーを評価する。
		const inputKind: EffectInputKind = mapParameterTree<CustomNodeGraphEffectParameterBinding>(parameter, saved, [], (leaf, binding) => {
			if (leaf.canNode !== true) return null;
			// 未接続の出力を読む場合は、描画時にも型に対応するゼロの定数を渡す。
			return binding.inputSource === 'literal' ? 'uniform' : connectionKind(binding) ?? 'uniform';
		});
		const read: ParameterReader = (publicValues, nodeOutputs) => mapParameterTree<CustomNodeGraphEffectParameterBinding>(
			parameter, saved, [], (leaf, binding) => {
				if (binding.inputSource === 'literal') {
					return leaf.canNode === true ? constantShaderInput(leaf.dataType.kind, binding.value) : binding.value;
				}
				if (binding.inputSource === 'publicParameter') {
					const value = publicValues[binding.parameterId];
					if (leaf.canNode !== true) return value;
					if (graph.paramDefs[binding.parameterId].canNode !== true) return constantShaderInput(leaf.dataType.kind, value);
					return readConnectedInput(value as UniformOrTexture, leaf.dataType, binding.sampling);
				}
				const value = nodeOutputs.get(binding.nodeId)!.get(binding.outputPort);
				return value == null ? constantShaderInput(leaf.dataType.kind, null) : readConnectedInput(value, leaf.dataType, binding.sampling);
			});
		if (connectedParameters.has(id)) return { id, inputKind, read };
		const constant = read({}, new Map());
		return { id, inputKind, read: () => constant };
	});
}

/** すべての参照を合流させてから描画する。同じ配置の別ポートを読む際に履歴を二重に進めない。 */
function planNodeOutputs(outputs: ReadonlyMap<string, CustomNodeGraphEffectConnection>, nodes: ReadonlyMap<string, PlannedNode>, outputIds: Iterable<string>) {
	const requests = new Map<PlannedNode, Set<string>>();

	function request(connection: CustomNodeGraphEffectConnection): void {
		if (connection.inputSource === 'publicParameter') return;
		const node = nodes.get(connection.nodeId)!;
		const requested = requests.get(node);
		if (requested != null) {
			requested.add(connection.outputPort);
			return;
		}
		// 静的に検証済みの配線をたどる。挿入順がそのまま入力から出力への描画順になる。
		for (const dependency of node.connections) request(dependency.connection);
		requests.set(node, new Set([connection.outputPort]));
	}

	for (const id of outputIds) {
		const connection = outputs.get(id);
		if (connection != null) request(connection);
	}
	return requests;
}

export async function createCustomNodeGraphEffectInstance(
	definition: CustomNodeGraphEffect, options: EffectInstanceOptions,
	resolveDefinition: (source: EffectSource) => EffectDefinition,
	createChildInstance: (source: EffectSource, options: EffectInstanceOptions) => Promise<EffectInstance>,
): Promise<EffectInstance> {
	const outputs = new Map(Object.entries(definition.outputs));
	const nodes = new Map(definition.nodes.map(node => {
		const child = resolveDefinition(node.effectSource);
		return [node.id, { node, definition: child, connections: [...getCustomNodeGraphEffectNodeConnections(child, node)] }];
	}));
	const placements = new Map<string, { instance: EffectInstance; parameters: PlannedParameter[] }>();

	function connectionKind(connection: CustomNodeGraphEffectConnection): UniformOrTexture['kind'] | null {
		if (connection.inputSource === 'node') return placements.get(connection.nodeId)!.instance.getOutputKind(connection.outputPort);
		// 公開入力からCPU値を接続可能な入力へ渡すときは定数になる。GPU入力は配置時の種別を引き継ぐ。
		if (definition.paramDefs[connection.parameterId].canNode !== true) return 'uniform';
		return options.inputKinds[connection.parameterId] as UniformOrTexture['kind'];
	}

	function connectionResolution(connection: CustomNodeGraphEffectConnection): Resolution | null {
		return connection.inputSource === 'publicParameter' ? options.inputResolutions?.get(connection.parameterId) ?? null
			: placements.get(connection.nodeId)!.instance.getOutputResolution(connection.outputPort);
	}

	function dispose(): void {
		for (const { instance } of placements.values()) instance.dispose();
		placements.clear();
	}

	try {
		for (const child of planNodeOutputs(outputs, nodes, outputs.keys()).keys()) {
			const node = child.node;
			const parameters = planParameters(definition, child, connectionKind);
			const inputResolutions = new Map<string, Resolution | null>();
			for (const { parameterId, connection } of child.connections) {
				const size = connectionResolution(connection);
				const current = inputResolutions.get(parameterId);
				if (size != null && (current == null || size.width * size.height > current.width * current.height)) inputResolutions.set(parameterId, size);
			}
			// 親の描画寸法・入力にテクスチャがない場合も、公開された各子出力は固有の寸法を返し得る。
			let largestInput: Resolution | null = null;
			for (const id of child.definition.resolutionInputParameters) {
				const size = inputResolutions.get(id);
				if (size != null && (largestInput == null || size.width * size.height > largestInput.width * largestInput.height)) largestInput = size;
			}
			const instance = await createChildInstance(node.effectSource, {
				...options, inputResolutions, inputKinds: Object.fromEntries(parameters.map(({ id, inputKind }) => [id, inputKind])),
				resolution: node.resolution ?? largestInput ?? options.resolution, staticSettings: node.staticSettings,
			});
			placements.set(node.id, { instance, parameters });
		}
	} catch (error) {
		// 初期化済みの兄弟の所有リソースも、その配置を使わない場合はここで解放する。
		dispose();
		throw error;
	}
	return {
		getOutputKind(outputId) {
			const connection = outputs.get(outputId);
			return connection == null ? null : connectionKind(connection);
		},
		getOutputResolution(outputId) {
			const connection = outputs.get(outputId);
			return connection == null ? null : connectionResolution(connection);
		},
		render(context) {
			const nodeOutputs = new Map<string, NodeOutputs>();
			const requests = planNodeOutputs(outputs, nodes, context.requestedOutputIds);
			for (const [{ node }, requestedOutputIds] of requests) {
				const { instance, parameters } = placements.get(node.id)!;
				const params = Object.fromEntries(parameters.map(({ id, read }) => [id, read(context.params, nodeOutputs)]));
				nodeOutputs.set(node.id, instance.render({ ...context, params, requestedOutputIds }));
			}
			const values = new Map<string, UniformOrTexture>();
			for (const id of context.requestedOutputIds) {
				const connection = outputs.get(id);
				if (connection == null) continue;
				const value = connection.inputSource === 'publicParameter' ? context.params[connection.parameterId] as UniformOrTexture
					: nodeOutputs.get(connection.nodeId)!.get(connection.outputPort);
				// 公開入力から出力への直結は、内部用のsamplingや所有権を次の利用者へ引き継がない。
				if (value != null) values.set(id, value.kind === 'texture' ? { kind: 'texture', texture: value.texture } : value);
			}
			return values;
		},
		dispose,
	};
}
