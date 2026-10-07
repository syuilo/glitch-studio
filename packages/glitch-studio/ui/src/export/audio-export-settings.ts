import { createSpeechResolver } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import type { PreparedSpeech } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import { getSceneAudioPlacements, resolveSceneAudioPlacements } from '@gs/subsystems_timeline_shared/scene-audio.ts';
import type { TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineExportSettings } from './timeline-export.ts';

export const MP4_AUDIO_SAMPLE_RATE = 48000;
export const MP4_AUDIO_BITRATE = 192000;

function getExportAudioPlan(scenes: readonly TimelineScene[], sceneId: string, settings: TimelineExportSettings, speech: readonly PreparedSpeech[]) {
	const intersects = (interval: { startMs: number; endMs: number }) => settings.format === 'mp4' && interval.startMs < settings.endTimeMs && interval.endMs > settings.positionMs;
	const placements = getSceneAudioPlacements(scenes, sceneId).filter(intersects);
	const { clips, missingSpeech } = resolveSceneAudioPlacements(placements, createSpeechResolver(speech));
	// 配置は範囲内でも、生成した音声が短ければ書き出し開始前に終わることがある。
	return { clips: clips.filter(intersects), missingSpeech };
}

/** 概算表示では未生成の発話も音声ありとし、準備前のダイアログを表示できるようにする。 */
export function hasExportAudio(scenes: readonly TimelineScene[], sceneId: string, settings: TimelineExportSettings, speech: readonly PreparedSpeech[] = []): boolean {
	const { clips, missingSpeech } = getExportAudioPlan(scenes, sceneId, settings, speech);
	return clips.length > 0 || missingSpeech.length > 0;
}

export function getExportAudioClips(scenes: readonly TimelineScene[], sceneId: string, settings: TimelineExportSettings, speech: readonly PreparedSpeech[] = []) {
	const { clips, missingSpeech } = getExportAudioPlan(scenes, sceneId, settings, speech);
	// UIの準備手順を通らない呼び出しでも、未生成の発話を無音として書き出さない。
	if (missingSpeech.length > 0) throw new Error('Generate VOICEVOX audio before exporting.');
	return clips;
}
