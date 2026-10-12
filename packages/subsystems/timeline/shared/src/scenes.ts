import { inspectReferenceGraph } from '@gs/shared/validation/diagnostic.ts';
import { inspectTimelineLayer, inspectTimelineSceneSettings } from './static-validation.ts';
import { isTimelineContainerLayer } from './types.ts';
import { flattenTimelineLayers, getTimelineClipLayers } from './layer-tree.ts';
import { getTimelineClipEnd } from './timing.ts';
import type { TimelineLayer, TimelineScene } from './types.ts';

/** 子の長さを再帰計算しない。配置済みの区間は、参照先の編集でも変えない。 */
export function getSceneDuration(scene: TimelineScene): number {
	return getTimelineClipLayers(scene.layers).reduce((duration, layer) => layer.clips.reduce((end, clip) => Math.max(end, getTimelineClipEnd(clip)), duration), 0);
}

export function getTimelineScene(scenes: readonly TimelineScene[], sceneId: string): TimelineScene {
	const scene = scenes.find(scene => scene.id === sceneId);
	if (scene == null) throw new Error(`Scene not found: ${sceneId}`);
	return scene;
}

export function validateTimelineLayer(layer: TimelineLayer): void {
	const diagnostics = inspectTimelineLayer(layer);
	if (diagnostics.length) throw new Error(diagnostics[0].message);
	if (isTimelineContainerLayer(layer)) for (const child of layer.layers) validateTimelineLayer(child);
}

/** 編集側のassert API。レンダラーは検証単位ごとの診断を保持する。 */
export function validateTimelineScenes(scenes: readonly TimelineScene[]): void {
	const graph = new Map(scenes.map(scene => [scene.id, flattenTimelineLayers(scene.layers).flatMap(layer => layer.layerType === 'scene' ? layer.clips.map(clip => clip.sceneId) : [])]));
	if (graph.size !== scenes.length) throw new Error('Duplicate scene ID');
	for (const scene of scenes) {
		const diagnostics = inspectTimelineSceneSettings(scene);
		if (diagnostics.length) throw new Error(diagnostics[0].message);
		const layers = flattenTimelineLayers(scene.layers);
		if (new Set(layers.map(layer => layer.id)).size !== layers.length) throw new Error(`Duplicate layer ID in scene: ${scene.name}`);
		for (const layer of scene.layers) validateTimelineLayer(layer);
	}
	const diagnostics = inspectReferenceGraph(graph);
	if (diagnostics.length) throw new Error(diagnostics[0].code === 'reference.cycle' ? `Circular scene reference: ${diagnostics[0].message}` : `Scene not found: ${diagnostics[0].message}`);
}

export function canReferenceScene(scenes: readonly TimelineScene[], parentId: string, childId: string): boolean {
	const visited = new Set<string>();
	const reachesParent = (id: string): boolean => {
		if (id === parentId) return true;
		if (visited.has(id)) return false;
		visited.add(id);
		return flattenTimelineLayers(getTimelineScene(scenes, id).layers).some(layer => layer.layerType === 'scene' && layer.clips.some(clip => reachesParent(clip.sceneId)));
	};
	return !reachesParent(childId);
}
