import { findTimelineLayer, flattenTimelineLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectEffectNode } from '@gs/subsystems_effect_shared/custom-node-graph-effect.ts';
import type { EffectSource } from '@gs/subsystems_effect_shared/effect-source.ts';
import type { TimelineEffectLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { AppStateChange, ProjectState } from '../Project.ts';
import type { PreparedCommandChange } from '../utility/undo-redo.ts';

type PlacementEdit<T> = (current: T, restore: boolean) => void;

/**
 * 登録定義は登録元で一度だけ、インライン定義は配置元から再帰して調べる。
 * 履歴には変更する配置のIDと編集だけを残し、Undo/Redo時は現在の定義から引き直す。
 */
export function prepareProjectEffectPlacementChanges(state: ProjectState, options: {
	customNodeGraphEffect?: (customNodeGraphEffect: CustomNodeGraphEffect) => PlacementEdit<CustomNodeGraphEffect> | null;
	node?: (node: CustomNodeGraphEffectEffectNode, containingCustomNodeGraphEffect: CustomNodeGraphEffect) => PlacementEdit<CustomNodeGraphEffectEffectNode> | null;
	layerArguments?: (layer: TimelineEffectLayer, sceneId: string) => PlacementEdit<TimelineEffectLayer> | null;
}): PreparedCommandChange<ProjectState, AppStateChange> {
	function includeInlineDefinition<T extends { effectSource: EffectSource }>(placement: T, edit: PlacementEdit<T> | null): PlacementEdit<T> | null {
		const nested = placement.effectSource.type === 'inlineCustomNodeGraphEffect' ? prepareCustomNodeGraphEffect(placement.effectSource.customNodeGraphEffect) : null;
		if (nested == null) return edit;
		return (current, restore) => {
			edit?.(current, restore);
			if (current.effectSource.type === 'inlineCustomNodeGraphEffect') nested(current.effectSource.customNodeGraphEffect, restore);
		};
	}

	function prepareCustomNodeGraphEffect(customNodeGraphEffect: CustomNodeGraphEffect): PlacementEdit<CustomNodeGraphEffect> | null {
		if (options.node == null && options.customNodeGraphEffect == null) return null;
		const editCustomNodeGraphEffect = options.customNodeGraphEffect?.(customNodeGraphEffect) ?? null;
		const edits = new Map<string, PlacementEdit<CustomNodeGraphEffectEffectNode>>();
		for (const node of customNodeGraphEffect.nodes) {
			if (node.type === 'relay') continue;
			const edit = includeInlineDefinition(node, options.node?.(node, customNodeGraphEffect) ?? null);
			if (edit != null) edits.set(node.id, edit);
		}
		if (edits.size === 0) return editCustomNodeGraphEffect;
		return (current, restore) => {
			editCustomNodeGraphEffect?.(current, restore);
			for (const node of current.nodes) if (node.type !== 'relay') edits.get(node.id)?.(node, restore);
		};
	}

	const changes: AppStateChange[] = [];
	const edits: PlacementEdit<ProjectState>[] = [];
	for (const { id, definition } of state.customNodeGraphEffects.value) {
		const edit = prepareCustomNodeGraphEffect(definition);
		if (edit == null) continue;
		changes.push({ type: 'customNodeGraphEffect', target: { customNodeGraphEffectId: id } });
		edits.push((current, restore) => edit(current.customNodeGraphEffects.value.find(entry => entry.id === id)!.definition, restore));
	}
	for (const { id: sceneId, layers } of state.timelineScenes.value) for (const layer of flattenTimelineLayers(layers)) {
		if (layer.layerType !== 'effect') continue;
		const editArguments = options.layerArguments?.(layer, sceneId) ?? null;
		const editInlineDefinition = includeInlineDefinition(layer, null);
		if (editArguments == null && editInlineDefinition == null) continue;
		const layerId = layer.id;
		if (editArguments != null) changes.push({ type: 'layer', sceneId, layerId, changes: [{ type: 'parameter', target: 'effect', kind: 'inputSource' }] });
		if (editInlineDefinition != null) changes.push({ type: 'customNodeGraphEffect', target: { sceneId, layerId } });
		edits.push((current, restore) => {
			const scene = current.timelineScenes.value.find(scene => scene.id === sceneId)!;
			const currentLayer = findTimelineLayer(scene.layers, layerId);
			if (currentLayer?.layerType !== 'effect') return;
			editArguments?.(currentLayer, restore);
			editInlineDefinition?.(currentLayer, restore);
		});
	}
	return {
		changes,
		apply(current) { for (const edit of edits) edit(current, false); },
		revert(current) { for (const edit of edits) edit(current, true); },
	};
}
