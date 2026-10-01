import { getTimelineLayerEnd, isTimelineLayerTimingValid } from './timing.ts';
import type { TimelineScene } from './types.ts';
import { validateSceneResolution } from './scene-resolution.ts';

/** 子の長さを再帰計算しない。配置済みの区間は、参照先の編集でも変えない。 */
export function getSceneDuration(scene: TimelineScene): number {
	return scene.layers.reduce((duration, layer) => Math.max(duration, getTimelineLayerEnd(layer)), 0);
}

export function getTimelineScene(scenes: readonly TimelineScene[], sceneId: string): TimelineScene {
	const scene = scenes.find(scene => scene.id === sceneId);
	if (scene == null) throw new Error(`Scene not found: ${sceneId}`);
	return scene;
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
			if (!isTimelineLayerTimingValid(layer)) throw new Error(`Invalid layer timing in scene: ${scene.name}`);
			if (layer.layerType === 'image' && layer.trimStartMs !== 0) throw new Error(`Image layers cannot be trimmed in scene: ${scene.name}`);
			if (layer.layerType === 'scene') visit(layer.sceneId);
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
		return getTimelineScene(scenes, id).layers.some(layer => layer.layerType === 'scene' && reachesParent(layer.sceneId));
	};
	return !reachesParent(childId);
}
