import { getNodesEffectView, saveNodesEffectView } from './nodes-effect-view.ts';
import { flattenTimelineLayers, findTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import type { NodesEffect } from '@/types/nodes-effect-view.ts';
import type { ProjectState } from '../Project.ts';
import type { NodesEffectTarget } from '@gs/glitch-studio_shared/project/nodes-effect-target.ts';

// 編集対象の所在はプロジェクトが管理し、Nodes Effectの定義には持ち込まない。
export type { NodesEffectTarget } from '@gs/glitch-studio_shared/project/nodes-effect-target.ts';

export function findNodesEffectOwner(state: ProjectState, target: NodesEffectTarget) {
	if ('nodesEffectId' in target) {
		return state.nodesEffects.value.find(nodesEffect => nodesEffect.id === target.nodesEffectId) ?? null;
	}
	const layer = findTimelineLayer(state.timelineScenes.value.find(scene => scene.id === target.sceneId)?.layers ?? [], target.layerId);
	return layer?.layerType === 'effect' && layer.effectSource.type === 'inlineNodesEffect' ? layer.effectSource : null;
}

export function findNodesEffect(state: ProjectState, target: NodesEffectTarget): NodesEffect | null {
	const owner = findNodesEffectOwner(state, target);
	return owner == null ? null : getNodesEffectView(owner, state);
}

export function saveNodesEffect(state: ProjectState, target: NodesEffectTarget, view: NodesEffect, nodeId?: string) {
	const owner = findNodesEffectOwner(state, target);
	if (owner == null) throw new Error('Nodes Effect not found');
	saveNodesEffectView(owner, state, view, nodeId);
}

export function getNodesEffect(state: ProjectState, target: NodesEffectTarget): NodesEffect {
	const nodesEffect = findNodesEffect(state, target);
	if (nodesEffect == null) throw new Error('Nodes Effect not found');
	return nodesEffect;
}

export function listNodesEffects(state: ProjectState): { target: NodesEffectTarget; nodesEffect: NodesEffect }[] {
	return [
		...state.nodesEffects.value.map(nodesEffect => ({ target: { nodesEffectId: nodesEffect.id }, nodesEffect: getNodesEffectView(nodesEffect, state) })),
		...state.timelineScenes.value.flatMap(scene => flattenTimelineLayers(scene.layers).flatMap(layer => layer.layerType === 'effect' && layer.effectSource.type === 'inlineNodesEffect'
			? [{ target: { sceneId: scene.id, layerId: layer.id }, nodesEffect: getNodesEffectView(layer.effectSource, state) }] : [])),
	];
}
