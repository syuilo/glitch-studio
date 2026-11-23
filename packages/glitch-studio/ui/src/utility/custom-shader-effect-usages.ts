import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { isTextureDataType } from '@gs/shared/data-type/data-type.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { areNodeDataTypesCompatible, getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import { walkParameters, resolveParameter } from '@gs/shared/parameter/parameter-path.ts';
import { getEffectLayerParameterDefault } from '@gs/subsystems_timeline_shared/layers/effect/effect-layer.ts';
import { flattenTimelineLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { resolveEffectSource } from '@gs/subsystems_effect_shared/effect-source.ts';
import type { EffectSource } from '@gs/subsystems_effect_shared/effect-source.ts';
import type { NodesEffect, NodesEffectOutputSource, NodesEffectParameterBinding } from '@gs/subsystems_effect_shared/nodes-effect.ts';
import { getEffectDefinitions } from './project-effects.ts';
import type { ProjectState } from '../Project.ts';
import type { TimelineEffectLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { ProjectNodesEffect, ProjectCustomShaderEffect } from '@gs/glitch-studio_shared/project/types.ts';

function usesShader(source: EffectSource, id: string): boolean {
	return source.type === 'customShaderEffectReference' ? source.id === id
		: source.type === 'inlineNodesEffect' && nodesEffectUsesShader(source.nodesEffect, id);
}

function nodesEffectUsesShader(nodesEffect: NodesEffect, id: string): boolean {
	return nodesEffect.nodes.some(node => node.type !== 'relay' && usesShader(node.effectSource, id));
}

export function isCustomShaderEffectUsed(state: ProjectState, id: string): boolean {
	return state.nodesEffects.value.some(entry => nodesEffectUsesShader(entry.definition, id))
		|| state.timelineScenes.value.some(scene => flattenTimelineLayers(scene.layers).some(layer => layer.layerType === 'effect' && usesShader(layer.effectSource, id)));
}

export function reconcileCustomShaderEffectUsages(state: ProjectState, previous: ProjectCustomShaderEffect, next: ProjectCustomShaderEffect) {
	const nodesEffectChanges: { before: ProjectNodesEffect; after: ProjectNodesEffect }[] = [];
	const layers: { sceneId: string; before: TimelineEffectLayer; after: TimelineEffectLayer }[] = [];
	// WGSL本文や表示名だけの変更では配線も引数も変わらない。
	if (deepEqual(previous.definition.paramDefs, next.definition.paramDefs) && deepEqual(previous.definition.outputDefs, next.definition.outputDefs)) return { nodesEffectChanges, layers };
	const definitions = getEffectDefinitions({ nodesEffects: state.nodesEffects,
		customShaderEffects: { value: state.customShaderEffects.value.map(entry => entry.id === next.id ? next : entry) } });
	const matches = (source: EffectSource) => source.type === 'customShaderEffectReference' && source.id === next.id;
	const nextParams = next.definition.paramDefs;

	function reconcileSource(source: EffectSource): EffectSource {
		return source.type === 'inlineNodesEffect' && nodesEffectUsesShader(source.nodesEffect, next.id) ? { ...source, nodesEffect: reconcileNodesEffect(source.nodesEffect) } : source;
	}

	function reconcileNodesEffect(nodesEffect: NodesEffect): NodesEffect {
		const changed = new Set(nodesEffect.nodes.filter(node => node.type !== 'relay' && matches(node.effectSource)).map(node => node.id));
		const outputType = (source: NodesEffectOutputSource) => {
			if ('parameterId' in source) return nodesEffect.paramDefs[source.parameterId]?.dataType;
			const node = nodesEffect.nodes.find(node => node.id === source.nodeId);
			if (node == null) return null;
			return node.type === 'relay' ? node.dataType : resolveEffectSource(node.effectSource, definitions).definition.outputDefs[source.outputPort]?.dataType;
		};

		function canKeepOutputConnection(source: NodesEffectOutputSource | null | undefined, input: ReturnType<typeof getNodeInputDataType>) {
			if (source == null || !('nodeId' in source) || !changed.has(source.nodeId)) return true;
			const output = next.definition.outputDefs[source.outputPort];
			// 参照先の型が同じなら、名前や他のポートを編集しても許可済みの型不一致の配線を保持する。
			return output != null && (previous.definition.outputDefs[source.outputPort]?.dataType.kind === output.dataType.kind
				|| areNodeDataTypesCompatible(output.dataType, input));
		}

		const nodes = nodesEffect.nodes.map(node => {
			if (node.type === 'relay') return canKeepOutputConnection(node.input, node.dataType) ? node : { ...node, input: null };
			const effectSource = reconcileSource(node.effectSource);
			const parameterDefs = resolveEffectSource(effectSource, definitions).definition.paramDefs;
			const params: Record<string, NodesEffectParameterBinding> = deepClone(node.params);
			if (matches(effectSource)) {
				for (const id of Object.keys(params)) if (!Object.hasOwn(nextParams, id)) delete params[id];
				for (const [id, def] of Object.entries(nextParams)) {
					const value = params[id];
					if (previous.definition.paramDefs[id]?.dataType.kind === def.dataType.kind && value != null) continue;
					const from = value?.inputSource === 'node' ? value.source : value?.inputSource === 'nodesEffectPublicParameterReference' ? { parameterId: value.parameterId } : null;
					const type = from == null ? null : outputType(from);
					if (type == null || !isTextureDataType(type) || !areNodeDataTypesCompatible(type, def.dataType)) params[id] = createDefaultParameterBinding(def);
				}
			}
			if (changed.size > 0) for (const { path, def, value } of walkParameters<NodesEffectParameterBinding>(parameterDefs, params)) {
				if (value.inputSource === 'node' && !canKeepOutputConnection(value.source, getNodeInputDataType(def))) resolveParameter<NodesEffectParameterBinding>(parameterDefs, params, path).setValue({ ...value, source: null });
			}
			return { ...node, effectSource, params };
		});
		const outputSources = Object.fromEntries(Object.entries(nodesEffect.outputSources).filter(([id, source]) => canKeepOutputConnection(source, nodesEffect.outputDefs[id]?.dataType)));
		return { ...nodesEffect, nodes, outputSources };
	}

	for (const before of state.nodesEffects.value) {
		if (!nodesEffectUsesShader(before.definition, next.id)) continue;
		const after = { ...before, definition: reconcileNodesEffect(before.definition) };
		if (!deepEqual(before, after)) nodesEffectChanges.push({ before, after });
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
	return { nodesEffectChanges, layers };
}
