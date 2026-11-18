import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import { isValueParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import { inspectStaticParameter, validateParameterDefaultValues } from '@gs/shared/parameter/static-parameter.ts';
import { validateStaticSettings } from '@gs/shared/static-setting.ts';
import { findDependencyCycle } from '@gs/shared/utility/dependency-cycle.ts';
import { validateCustomShaderEffectDefinition } from './custom-shader-effect/custom-shader-effect.ts';
import { resolveEffectSource } from './effect-source.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectConnection } from './custom-node-graph-effect/custom-node-graph-effect.ts';
import type { EffectCatalog, EffectSource, ResolvedEffectSource } from './effect-source.ts';

function validateNodeConnections(graph: CustomNodeGraphEffect, sources: ReadonlyMap<string, ResolvedEffectSource>): void {
	for (const parameter of Object.values(graph.paramDefs)) validateParameterDefaultValues(parameter);
	if (graph.primaryInputParameter != null && graph.paramDefs[graph.primaryInputParameter]?.canNode !== true) {
		throw new Error(`Invalid Custom Node Graph Effect primary input: ${graph.primaryInputParameter}`);
	}
	if (graph.primaryAudioInputParameter != null && graph.paramDefs[graph.primaryAudioInputParameter]?.dataType.kind !== 'audioSource') {
		throw new Error(`Invalid Custom Node Graph Effect primary audio input: ${graph.primaryAudioInputParameter}`);
	}
	if (graph.primaryOutput != null && !Object.hasOwn(graph.outputDefs, graph.primaryOutput)) {
		throw new Error(`Unknown Custom Node Graph Effect primary output: ${graph.primaryOutput}`);
	}
	for (const id of graph.resolutionInputParameters) {
		if (!Object.hasOwn(graph.paramDefs, id)) throw new Error(`Unknown Custom Node Graph Effect resolution input: ${id}`);
	}
	const dependencies = new Map<string, string[]>();
	const requireConnection = (connection: CustomNodeGraphEffectConnection) => {
		if (connection.inputSource === 'customNodeGraphEffectPublicParameterReference') {
			if (!Object.hasOwn(graph.paramDefs, connection.parameterId)) throw new Error(`Unknown public parameter: ${connection.parameterId}`);
		} else {
			const producer = sources.get(connection.nodeId);
			if (producer == null) throw new Error(`Unknown node: ${connection.nodeId}`);
			if (!Object.hasOwn(producer.definition.outputDefs, connection.outputPort)) throw new Error(`Unknown output: ${connection.nodeId}.${connection.outputPort}`);
		}
	};
	for (const node of graph.nodes) {
		const definition = sources.get(node.id)!.definition;
		const inputNodes: string[] = [];
		dependencies.set(node.id, inputNodes);
		validateStaticSettings(definition.staticSettingDefs ?? {}, node.staticSettings ?? {});
		for (const parameterId of Object.keys(node.params)) {
			if (!Object.hasOwn(definition.paramDefs, parameterId)) throw new Error(`Unknown input: ${node.id}.${parameterId}`);
		}
		for (const [id, parameter] of Object.entries(definition.paramDefs)) {
			inspectStaticParameter(parameter, node.params[id] ?? parameter.defaultValue, (leaf, binding) => {
				if (binding.inputSource === 'node') {
					if (leaf.canNode !== true) throw new Error(`Input does not accept a node connection: ${node.id}.${id}`);
					requireConnection(binding);
					inputNodes.push(binding.nodeId);
				} else if (binding.inputSource === 'customNodeGraphEffectPublicParameterReference') {
					requireConnection(binding);
					const publicParameter = graph.paramDefs[binding.parameterId];
					if ((publicParameter.canNode === true && leaf.canNode !== true)
						|| (publicParameter.canNode !== true && !areDataTypesEqual(publicParameter.dataType, leaf.dataType))) {
						throw new Error(`Incompatible public parameter: ${binding.parameterId} -> ${node.id}.${id}`);
					}
				} else if (!isValueParameterBinding(binding)) {
					throw new Error(`Unsupported Custom Node Graph Effect input: ${node.id}.${id}`);
				}
			});
		}
	}
	for (const [id, connection] of Object.entries(graph.outputs)) {
		if (!Object.hasOwn(graph.outputDefs, id)) throw new Error(`Unknown public output: ${id}`);
		requireConnection(connection);
		if (connection.inputSource === 'customNodeGraphEffectPublicParameterReference' && graph.paramDefs[connection.parameterId].canNode !== true) {
			throw new Error(`Public output requires a node-capable parameter: ${connection.parameterId}`);
		}
	}
	const cycle = findDependencyCycle(dependencies);
	if (cycle != null) throw new Error(`Node connection cycle: ${cycle.join(' -> ')}`);
}

/** 編集・読み込み側が呼ぶ静的検証。未接続ノードも含めて検査し、描画中の要求出力には依存しない。 */
export function validateEffectSource(source: EffectSource, catalog: EffectCatalog): void {
	// 同じ登録定義を複数の配置で使える。探索中の祖先への再入だけが循環で、探索済みの定義は再検査しない。
	// 登録IDで検索結果の同一性を表せるので、カタログが呼び出しごとにスナップショットを返しても機能する。
	const completed = new Set<string | CustomNodeGraphEffect>();
	const active = new Set<string | CustomNodeGraphEffect>();
	const path: string[] = [];
	const visit = (placement: EffectSource, resolved: ResolvedEffectSource, placementLabel: string) => {
		if (resolved.type === 'nativeEffect') return;
		if (resolved.type === 'customShaderEffect') {
			validateCustomShaderEffectDefinition(resolved.definition);
			return;
		}
		const graph = resolved.definition;
		const identity = placement.type === 'customNodeGraphEffectReference' ? placement.id : graph;
		if (completed.has(identity)) return;
		const label = placement.type === 'customNodeGraphEffectReference' ? placement.id : placementLabel;
		if (active.has(identity)) throw new Error(`Custom Node Graph Effect reference cycle: ${[...path, label].join(' -> ')}`);
		active.add(identity);
		path.push(label);
		const nodeSources = new Map<string, ResolvedEffectSource>();
		for (const node of graph.nodes) {
			if (nodeSources.has(node.id)) throw new Error(`Duplicate node ID: ${node.id}`);
			const child = resolveEffectSource(node.effectSource, catalog);
			nodeSources.set(node.id, child);
			visit(node.effectSource, child, node.id);
		}
		validateNodeConnections(graph, nodeSources);
		path.pop();
		active.delete(identity);
		completed.add(identity);
	};
	visit(source, resolveEffectSource(source, catalog), 'inline');
}
