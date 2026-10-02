import { getSceneAudioClips } from '@gs/subsystems_timeline_shared/scene-audio.ts';
import type { TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineExportSettings } from './timeline-export.ts';

export const MP4_AUDIO_SAMPLE_RATE = 48000;
export const MP4_AUDIO_BITRATE = 192000;

export function getExportAudioClips(scenes: readonly TimelineScene[], sceneId: string, settings: TimelineExportSettings) {
	return getSceneAudioClips(scenes, sceneId)
		.filter(clip => settings.format === 'mp4' && clip.startMs < settings.endTimeMs && clip.endMs > settings.positionMs);
}
