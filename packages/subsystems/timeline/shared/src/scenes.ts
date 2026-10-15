import { isTimelineContainerLayer, isTimelineVisualLayer } from './types.ts';
import { validateTimelineMask } from './timeline-compositing.ts';
import { validateTimelineTransform } from './layers/transform/transform.ts';
import { validateEffectResolution } from '@gs/subsystems_effect_shared/resolution.js';
import { validateTimelineCamera } from './layers/camera/camera.ts';
import { flattenTimelineLayers, getTimelineClipLayers } from './layer-tree.ts';
import { getTimelineClipEnd, validateTimelineClips } from './timing.ts';
import { validateTimelineParameterBinding } from './parameter-binding.ts';
import { validateVoicevoxSubtitle } from './layers/voicevox/voicevox-subtitle-validation.ts';
import { validateTimelineText } from './layers/text/text-layer.ts';
import { validateTimelineShape } from './layers/shape/shape-layer.ts';
import { validateVoicevoxLayer } from './layers/voicevox/voicevox.ts';
import { validateTimelineMediaClipTiming } from './media-timing.ts';
import { validateTimelineVideoHoldTiming } from './layers/video/video-hold.ts';
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

/** パラメータや子孫をたどらず、レイヤー自身の区間・解像度・固有設定だけを検証する。 */
export function validateTimelineLayerStructure(layer: TimelineLayer): void {
	if (isTimelineVisualLayer(layer)) validateTimelineMask(layer.mask);
	if (!isTimelineContainerLayer(layer)) validateTimelineClips(layer.clips);
	if (layer.layerType === 'video' || layer.layerType === 'audio') {
		for (const clip of layer.clips) {
			if ('sourceTimeMs' in clip) {
				if (layer.layerType !== 'video') throw new Error('Only video clips can hold frames');
				validateTimelineVideoHoldTiming(clip);
				if (clip.audioEnabled !== false) throw new Error('Video hold must be silent');
			} else validateTimelineMediaClipTiming(clip);
		}
	} else if (!isTimelineContainerLayer(layer)) {
		for (const clip of layer.clips) {
			if (!Number.isFinite(clip.contentOffsetMs) || clip.contentOffsetMs < 0 || !Number.isFinite(clip.contentOffsetMs + clip.durationMs)) throw new Error('Invalid content offset');
		}
	}
	if (layer.layerType === 'voicevox') validateVoicevoxLayer(layer);
	if (layer.layerType === 'effect') validateEffectResolution(layer.resolution);
}

export function validateTimelineLayer(layer: TimelineLayer): void {
	validateTimelineLayerStructure(layer);
	if (isTimelineContainerLayer(layer)) {
		for (const child of layer.layers) validateTimelineLayer(child);
	}
	if (layer.layerType === 'transform') validateTimelineTransform(layer.transformParamValues);
	if (layer.layerType === 'camera') validateTimelineCamera({ paramValues: layer.cameraParamValues, automationGraphs: layer.automationGraphs });
	if (layer.layerType === 'text') validateTimelineText(layer.textParamValues);
	if (layer.layerType === 'voicevox') {
		validateVoicevoxSubtitle(layer.subtitleParamValues);
	}
	if (layer.layerType === 'shape') validateTimelineShape(layer.shape);
	const parameterGroups = [
		...('audioParamValues' in layer ? [layer.audioParamValues] : []),
		...('compositingParamValues' in layer ? [layer.compositingParamValues] : []),
	];
	for (const values of parameterGroups) for (const binding of Object.values(values)) validateTimelineParameterBinding(binding);
	if ('visualModuleParamValues' in layer) {
		for (const binding of Object.values(layer.visualModuleParamValues)) validateTimelineParameterBinding(binding, false, true);
	}
	if (layer.layerType === 'effect') {
		for (const binding of Object.values(layer.effectParamValues)) validateTimelineParameterBinding(binding, true);
	}
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
