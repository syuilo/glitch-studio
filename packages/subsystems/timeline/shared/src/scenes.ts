import { validateEffectResolution } from '@gs/subsystems_effect_shared/resolution.js';
import { getTimelineClipEnd, validateTimelineClips } from './timing.ts';
import { validateSceneResolution } from './scene-resolution.ts';
import { validateTimelineParameterBinding } from './parameter-binding.ts';
import type { TimelineLayer, TimelineScene } from './types.ts';

/** 子の長さを再帰計算しない。配置済みの区間は、参照先の編集でも変えない。 */
export function getSceneDuration(scene: TimelineScene): number {
	return scene.layers.reduce((duration, layer) => layer.clips.reduce((end, clip) => Math.max(end, getTimelineClipEnd(clip)), duration), 0);
}

export function getTimelineScene(scenes: readonly TimelineScene[], sceneId: string): TimelineScene {
	const scene = scenes.find(scene => scene.id === sceneId);
	if (scene == null) throw new Error(`Scene not found: ${sceneId}`);
	return scene;
}

export function validateTimelineLayer(layer: TimelineLayer): void {
	validateTimelineClips(layer.clips);
	const parameterGroups = [
		...('audioParamValues' in layer ? [layer.audioParamValues] : []),
		...('compositingParamValues' in layer ? [layer.compositingParamValues] : []),
		...('visualModuleParamValues' in layer ? [layer.visualModuleParamValues] : []),
	];
	for (const values of parameterGroups) for (const binding of Object.values(values)) validateTimelineParameterBinding(binding);
	if (layer.layerType === 'effect') {
		validateEffectResolution(layer.resolution);
		for (const binding of Object.values(layer.effectParamValues)) validateTimelineParameterBinding(binding, true);
	}
}

/** 同じSceneの複数配置は許可し、現在の参照経路に戻る場合だけ循環と判定する。 */
export function validateTimelineScenes(scenes: readonly TimelineScene[]): void {
	const byId = new Map(scenes.map(scene => [scene.id, scene]));
	if (byId.size !== scenes.length) throw new Error('Duplicate scene ID');
	const visited = new Set<string>();
	const path: string[] = [];
	const visit = (id: string) => {
		if (path.includes(id)) throw new Error(`Circular scene reference: ${[...path, id].join(' → ')}`);
		if (visited.has(id)) return;
		const scene = byId.get(id);
		if (scene == null) throw new Error(`Scene not found: ${id}`);
		validateSceneResolution(scene.resolution);
		if (new Set(scene.layers.map(layer => layer.id)).size !== scene.layers.length) throw new Error(`Duplicate layer ID in scene: ${scene.name}`);
		path.push(id);
		for (const layer of scene.layers) {
			validateTimelineLayer(layer);
			if (layer.layerType === 'scene') for (const clip of layer.clips) visit(clip.sceneId);
		}
		path.pop();
		visited.add(id);
	};
	for (const scene of scenes) visit(scene.id);
}

export function canReferenceScene(scenes: readonly TimelineScene[], parentId: string, childId: string): boolean {
	const visited = new Set<string>();
	const reachesParent = (id: string): boolean => {
		if (id === parentId) return true;
		if (visited.has(id)) return false;
		visited.add(id);
		return getTimelineScene(scenes, id).layers.some(layer => layer.layerType === 'scene' && layer.clips.some(clip => reachesParent(clip.sceneId)));
	};
	return !reachesParent(childId);
}
