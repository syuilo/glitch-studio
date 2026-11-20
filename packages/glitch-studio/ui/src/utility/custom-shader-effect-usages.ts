import { isTextureDataType } from '@gs/shared/data-type/data-type.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { areNodeDataTypesCompatible, getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import { walkParameters, resolveParameter } from '@gs/shared/parameter/parameter-path.ts';
import { getEffectLayerParameterDefault } from '@gs/subsystems_timeline_shared/layers/effect/effect-layer.ts';
import { flattenTimelineLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { resolveEffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { EffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectOutputSource, CustomNodeGraphEffectParameterBinding } from '@gs/subsystems_effect-new_shared/custom-node-graph-effect.ts';
import { getEffectDefinitions } from './project-effects.ts';
import type { ProjectState } from '../Project.ts';
import type { TimelineEffectLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { ProjectCustomNodeGraphEffect, ProjectCustomShaderEffect } from '@gs/glitch-studio_shared/project/types.ts';

function usesShader(source: EffectSource, id: string): boolean {
	return source.type === 'customShaderEffectReference' ? source.id === id
		: source.type === 'inlineCustomNodeGraphEffect' && graphUsesShader(source.customNodeGraphEffect, id);
}

function graphUsesShader(graph: CustomNodeGraphEffect, id: string): boolean {
	return graph.nodes.some(node => node.type !== 'relay' && usesShader(node.effectSource, id));
}

export function isCustomShaderEffectUsed(state: ProjectState, id: string): boolean {
	return state.customNodeGraphEffects.value.some(entry => graphUsesShader(entry.definition, id))
		|| state.timelineScenes.value.some(scene => flattenTimelineLayers(scene.layers).some(layer => layer.layerType === 'effect' && usesShader(layer.effectSource, id)));
}

export function reconcileCustomShaderEffectUsages(state: ProjectState, previous: ProjectCustomShaderEffect, next: ProjectCustomShaderEffect) {
	const graphs: { before: ProjectCustomNodeGraphEffect; after: ProjectCustomNodeGraphEffect }[] = [];
	const layers: { sceneId: string; before: TimelineEffectLayer; after: TimelineEffectLayer }[] = [];
	// WGSL本文や表示名だけの変更では配線も引数も変わらない。
	if (deepEqual(previous.definition.paramDefs, next.definition.paramDefs) && deepEqual(previous.definition.outputDefs, next.definition.outputDefs)) return { graphs, layers };
	const definitions = getEffectDefinitions({ customNodeGraphEffects: state.customNodeGraphEffects,
		customShaderEffects: { value: state.customShaderEffects.value.map(entry => entry.id === next.id ? next : entry) } });
	const matches = (source: EffectSource) => source.type === 'customShaderEffectReference' && source.id === next.id;
	const nextParams = next.definition.paramDefs;

	function reconcileSource(source: EffectSource): EffectSource {
		return source.type === 'inlineCustomNodeGraphEffect' && graphUsesShader(source.customNodeGraphEffect, next.id) ? { ...source, customNodeGraphEffect: reconcileGraph(source.customNodeGraphEffect) } : source;
	}

	function reconcileGraph(graph: CustomNodeGraphEffect): CustomNodeGraphEffect {
		const changed = new Set(graph.nodes.filter(node => node.type !== 'relay' && matches(node.effectSource)).map(node => node.id));
		const outputType = (source: CustomNodeGraphEffectOutputSource) => {
			if ('parameterId' in source) return graph.paramDefs[source.parameterId]?.dataType;
			const node = graph.nodes.find(node => node.id === source.nodeId);
			if (node == null) return null;
			return node.type === 'relay' ? node.dataType : resolveEffectSource(node.effectSource, definitions).definition.outputDefs[source.outputPort]?.dataType;
		};
		function canKeepOutputConnection(source: CustomNodeGraphEffectOutputSource | null | undefined, input: ReturnType<typeof getNodeInputDataType>) {
			if (source == null || !('nodeId' in source) || !changed.has(source.nodeId)) return true;
			const output = next.definition.outputDefs[source.outputPort];
			// 参照先の型が同じなら、名前や他のポートを編集しても許可済みの型不一致の配線を保持する。
			return output != null && (previous.definition.outputDefs[source.outputPort]?.dataType.kind === output.dataType.kind
				|| areNodeDataTypesCompatible(output.dataType, input));
		}
		const nodes = graph.nodes.map(node => {
			if (node.type === 'relay') return canKeepOutputConnection(node.input, node.dataType) ? node : { ...node, input: null };
			const effectSource = reconcileSource(node.effectSource);
			const parameterDefs = resolveEffectSource(effectSource, definitions).definition.paramDefs;
			const params: Record<string, CustomNodeGraphEffectParameterBinding> = deepClone(node.params);
			if (matches(effectSource)) {
				for (const id of Object.keys(params)) if (!Object.hasOwn(nextParams, id)) delete params[id];
				for (const [id, def] of Object.entries(nextParams)) {
					const value = params[id];
					if (previous.definition.paramDefs[id]?.dataType.kind === def.dataType.kind && value != null) continue;
					const from = value?.inputSource === 'node' ? value.source : value?.inputSource === 'customNodeGraphEffectPublicParameterReference' ? { parameterId: value.parameterId } : null;
					const type = from == null ? null : outputType(from);
					if (type == null || !isTextureDataType(type) || !areNodeDataTypesCompatible(type, def.dataType)) params[id] = deepClone(def.defaultValue);
				}
			}
			if (changed.size > 0) for (const { path, def, value } of walkParameters<CustomNodeGraphEffectParameterBinding>(parameterDefs, params)) {
				if (value.inputSource === 'node' && !canKeepOutputConnection(value.source, getNodeInputDataType(def))) resolveParameter<CustomNodeGraphEffectParameterBinding>(parameterDefs, params, path).setValue({ ...value, source: null });
			}
			return { ...node, effectSource, params };
		});
		const outputSources = Object.fromEntries(Object.entries(graph.outputSources).filter(([id, source]) => canKeepOutputConnection(source, graph.outputDefs[id]?.dataType)));
		return { ...graph, nodes, outputSources };
	}

	for (const before of state.customNodeGraphEffects.value) {
		if (!graphUsesShader(before.definition, next.id)) continue;
		const after = { ...before, definition: reconcileGraph(before.definition) };
		if (!deepEqual(before, after)) graphs.push({ before, after });
	}
	for (const scene of state.timelineScenes.value) for (const before of flattenTimelineLayers(scene.layers)) {
		if (before.layerType !== 'effect' || !usesShader(before.effectSource, next.id)) continue;
		const after = { ...before, effectSource: reconcileSource(before.effectSource) };
		if (matches(after.effectSource)) after.effectParamValues = Object.fromEntries(Object.entries(nextParams).map(([id, def]) => {
			const value = before.effectParamValues[id];
			const compatible = previous.definition.paramDefs[id]?.dataType.kind === def.dataType.kind
				|| value != null && (value.inputSource === 'lowerLayerOutput' || value.inputSource === 'anotherLayerOutput') && areNodeDataTypesCompatible({ kind: 'color' }, def.dataType);
			return [id, value != null && compatible ? value : getEffectLayerParameterDefault(next.definition, id)];
		}));
		if (!deepEqual(before, after)) layers.push({ sceneId: scene.id, before, after });
	}
	return { graphs, layers };
}
