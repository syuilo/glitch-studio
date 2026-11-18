import { flattenTimelineLayers, findTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import type { CustomNodeGraphEffect } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import type { ProjectState } from '../Project.ts';
import type { CustomNodeGraphEffectTarget } from '@gs/glitch-studio_shared/project/custom-node-graph-effect-target.ts';

// 編集対象の所在はプロジェクトが管理し、Custom Node Graph Effectの定義には持ち込まない。
export type { CustomNodeGraphEffectTarget } from '@gs/glitch-studio_shared/project/custom-node-graph-effect-target.ts';

export function findCustomNodeGraphEffect(state: ProjectState, target: CustomNodeGraphEffectTarget): CustomNodeGraphEffect | null {
	if ('customNodeGraphEffectId' in target) {
		return state.customNodeGraphEffects.value.find(customNodeGraphEffect => customNodeGraphEffect.id === target.customNodeGraphEffectId) ?? null;
	}
	const layer = findTimelineLayer(state.timelineScenes.value.find(scene => scene.id === target.sceneId)?.layers ?? [], target.inlineCustomNodeGraphEffectLayerId);
	return layer?.layerType === 'inlineCustomNodeGraphEffect' ? layer.customNodeGraphEffect : null;
}

export function getCustomNodeGraphEffect(state: ProjectState, target: CustomNodeGraphEffectTarget): CustomNodeGraphEffect {
	const customNodeGraphEffect = findCustomNodeGraphEffect(state, target);
	if (customNodeGraphEffect == null) throw new Error('Custom Node Graph Effect not found');
	return customNodeGraphEffect;
}

export function listCustomNodeGraphEffects(state: ProjectState): { target: CustomNodeGraphEffectTarget; customNodeGraphEffect: CustomNodeGraphEffect }[] {
	return [
		...state.customNodeGraphEffects.value.map(customNodeGraphEffect => ({ target: { customNodeGraphEffectId: customNodeGraphEffect.id }, customNodeGraphEffect })),
		...state.timelineScenes.value.flatMap(scene => flattenTimelineLayers(scene.layers).flatMap(layer => layer.layerType === 'inlineCustomNodeGraphEffect'
			? [{ target: { sceneId: scene.id, inlineCustomNodeGraphEffectLayerId: layer.id }, customNodeGraphEffect: layer.customNodeGraphEffect }] : [])),
	];
}
