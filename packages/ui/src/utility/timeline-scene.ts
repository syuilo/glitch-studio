import { getTimelineScene } from '@glitch/shared/timeline/scenes.ts';
import type { AppState } from '../types.ts';
import type { TimelineLayer, TimelineParameterBinding } from '@glitch/shared/timeline/types.ts';

export function getScene(state: AppState, sceneId: string) {
	return getTimelineScene(state.timelineScenes.value, sceneId);
}

export function getLayerParameterValues(layer: TimelineLayer, target: 'module' | 'compositing' | 'audio'): Record<string, TimelineParameterBinding> {
	if (target === 'compositing' && layer.layerType !== 'audio') return layer.compositingParamValues;
	if (target === 'audio' && (layer.layerType === 'scene' || layer.layerType === 'video' || layer.layerType === 'audio')) return layer.audioParamValues;
	if (target === 'module' && (layer.layerType === 'visualModule' || layer.layerType === 'inlineVisualModule')) return layer.visualModuleParamValues;
	if (target === 'module' && layer.layerType === 'effect') return layer.effectParamValues;
	throw new Error('Invalid layer parameter target');
}
