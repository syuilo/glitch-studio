import { getCustomNodeGraphEffectView, saveCustomNodeGraphEffectView } from './custom-node-graph-effect-view.ts';
import { flattenTimelineLayers, findTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import type { CustomNodeGraphEffect } from '@/types/custom-node-graph-effect-view.ts';
import type { ProjectState } from '../Project.ts';
import type { CustomNodeGraphEffectTarget } from '@gs/glitch-studio_shared/project/custom-node-graph-effect-target.ts';

// 編集対象の所在はプロジェクトが管理し、Custom Node Graph Effectの定義には持ち込まない。
export type { CustomNodeGraphEffectTarget } from '@gs/glitch-studio_shared/project/custom-node-graph-effect-target.ts';

export function findCustomNodeGraphEffectOwner(state: ProjectState, target: CustomNodeGraphEffectTarget) {
	if ('customNodeGraphEffectId' in target) {
		return state.customNodeGraphEffects.value.find(customNodeGraphEffect => customNodeGraphEffect.id === target.customNodeGraphEffectId) ?? null;
	}
	const layer = findTimelineLayer(state.timelineScenes.value.find(scene => scene.id === target.sceneId)?.layers ?? [], target.layerId);
	return layer?.layerType === 'effect' && layer.effectSource.type === 'inlineCustomNodeGraphEffect' ? layer.effectSource : null;
}

export function findCustomNodeGraphEffect(state: ProjectState, target: CustomNodeGraphEffectTarget): CustomNodeGraphEffect | null {
	const owner = findCustomNodeGraphEffectOwner(state, target);
	return owner == null ? null : getCustomNodeGraphEffectView(owner, state);
}

export function saveCustomNodeGraphEffect(state: ProjectState, target: CustomNodeGraphEffectTarget, view: CustomNodeGraphEffect, nodeId?: string) {
	const owner = findCustomNodeGraphEffectOwner(state, target);
	if (owner == null) throw new Error('Custom Node Graph Effect not found');
	saveCustomNodeGraphEffectView(owner, state, view, nodeId);
}

export function getCustomNodeGraphEffect(state: ProjectState, target: CustomNodeGraphEffectTarget): CustomNodeGraphEffect {
	const customNodeGraphEffect = findCustomNodeGraphEffect(state, target);
	if (customNodeGraphEffect == null) throw new Error('Custom Node Graph Effect not found');
	return customNodeGraphEffect;
}

export function listCustomNodeGraphEffects(state: ProjectState): { target: CustomNodeGraphEffectTarget; customNodeGraphEffect: CustomNodeGraphEffect }[] {
	return [
		...state.customNodeGraphEffects.value.map(customNodeGraphEffect => ({ target: { customNodeGraphEffectId: customNodeGraphEffect.id }, customNodeGraphEffect: getCustomNodeGraphEffectView(customNodeGraphEffect, state) })),
		...state.timelineScenes.value.flatMap(scene => flattenTimelineLayers(scene.layers).flatMap(layer => layer.layerType === 'effect' && layer.effectSource.type === 'inlineCustomNodeGraphEffect'
			? [{ target: { sceneId: scene.id, layerId: layer.id }, customNodeGraphEffect: getCustomNodeGraphEffectView(layer.effectSource, state) }] : [])),
	];
}
