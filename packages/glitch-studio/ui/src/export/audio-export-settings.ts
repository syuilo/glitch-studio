import { createSpeechResolver, getVoicevoxRequestKey } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import type { PreparedSpeech } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import { getSceneAudioClips } from '@gs/subsystems_timeline_shared/scene-audio.ts';
import type { TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineExportSettings } from './timeline-export.ts';

export const MP4_AUDIO_SAMPLE_RATE = 48000;
export const MP4_AUDIO_BITRATE = 192000;

export function getExportAudioClips(scenes: readonly TimelineScene[], sceneId: string, settings: TimelineExportSettings, speech: readonly PreparedSpeech[] = []) {
	const resolve = createSpeechResolver(speech);
	const missing = new Set<string>();
	const clips = getSceneAudioClips(scenes, sceneId, { type: 'all' }, request => {
		const ready = resolve(request);
		if (ready) return ready;
		const key = getVoicevoxRequestKey(request);
		missing.add(key);
		return { key, sourceId: key, durationMs: Infinity };
	})
		.filter(clip => settings.format === 'mp4' && clip.startMs < settings.endTimeMs && clip.endMs > settings.positionMs);
	// UIの準備手順を通らない呼び出しでも、未生成の発話を無音として書き出さない。
	if (clips.some(clip => missing.has(clip.sourceId))) throw new Error('Generate VOICEVOX audio before exporting.');
	return clips;
}
