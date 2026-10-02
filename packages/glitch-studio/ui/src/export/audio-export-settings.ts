import { getSceneAudioClips } from '@gs/shared/timeline/scene-audio.ts';
import type { TimelineScene } from '@gs/shared/timeline/types.ts';
import type { TimelineExportSettings } from './timeline-export.ts';

export const MP4_AUDIO_SAMPLE_RATE = 48000;
export const MP4_AUDIO_BITRATE = 192000;

export function getExportAudioClips(scenes: readonly TimelineScene[], sceneId: string, settings: TimelineExportSettings) {
	return getSceneAudioClips(scenes, sceneId)
		.filter(clip => settings.format === 'mp4' && clip.startMs < settings.endTimeMs && clip.endMs > settings.positionMs);
}
