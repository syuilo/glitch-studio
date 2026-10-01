import { getTimelineScene } from '@glitch/shared/timeline/scenes.ts';
import type { AppState } from '../types.ts';
import type { TimelineLayer, TimelineParameterBinding } from '@glitch/shared/timeline/types.ts';

export function getScene(state: AppState, sceneId: string) {
	return getTimelineScene(state.timelineScenes.value, sceneId);
}

/** キーフレームの表示と選択で、存在しないパラメータ群を参照しないよう一覧を共有する。 */
export function getLayerParameterTargets(layer: TimelineLayer): readonly ('module' | 'compositing' | 'audio')[] {
	switch (layer.layerType) {
		case 'audio': return ['audio'];
		case 'image': return ['compositing'];
		case 'video':
		case 'scene': return ['compositing', 'audio'];
		case 'visualModule':
		case 'inlineVisualModule':
		case 'effect': return ['compositing', 'module'];
	}
}

export function getLayerParameterValues(layer: TimelineLayer, target: 'module' | 'compositing' | 'audio'): Record<string, TimelineParameterBinding> {
	if (target === 'compositing' && layer.layerType !== 'audio') return layer.compositingParamValues;
	if (target === 'audio' && (layer.layerType === 'scene' || layer.layerType === 'video' || layer.layerType === 'audio')) return layer.audioParamValues;
	if (target === 'module' && (layer.layerType === 'visualModule' || layer.layerType === 'inlineVisualModule')) return layer.visualModuleParamValues;
	if (target === 'module' && layer.layerType === 'effect') return layer.effectParamValues;
	throw new Error('Invalid layer parameter target');
}
