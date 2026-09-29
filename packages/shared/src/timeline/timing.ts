import type { TimelineLayer } from './types.ts';

/** 音声は素材の配置基準からトリムした分だけ遅れて再生を開始する。 */
export function getTimelineLayerStart(layer: TimelineLayer): number {
	return layer.positionMs + (layer.layerType === 'audio' ? layer.trimStartMs : 0);
}

export function getTimelineLayerEnd(layer: TimelineLayer): number {
	return getTimelineLayerStart(layer) + layer.trimmedDurationMs;
}
