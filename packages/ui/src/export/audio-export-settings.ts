import { getTimelineLayerStart, getTimelineLayerEnd } from '@glitch/shared/timeline/timing.ts';
import type { Timeline } from '@glitch/shared/timeline/types.ts';
import type { TimelineExportSettings } from './timeline-export.ts';

export const MP4_AUDIO_SAMPLE_RATE = 48000;
export const MP4_AUDIO_BITRATE = 192000;

export function getExportAudioLayers(timeline: Timeline, settings: TimelineExportSettings) {
	return timeline.filter(layer => layer.layerType === 'audio')
		.filter(layer => settings.format === 'mp4' && getTimelineLayerStart(layer) < settings.endTimeMs && getTimelineLayerEnd(layer) > settings.startTimeMs);
}
