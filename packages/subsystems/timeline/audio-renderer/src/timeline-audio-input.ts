import { getAudioWindowFrameCount } from '@gs/subsystems_audio_shared/audio-input.ts';
import type { AudioInput } from '@gs/subsystems_audio_shared/audio-input.ts';
import type { SceneAudioClip } from '@gs/subsystems_timeline_shared/scene-audio.ts';
import type { TimelineAudioRenderer } from './timeline-audio-renderer.ts';

export const TIMELINE_AUDIO_INPUT_SAMPLE_RATE = 48000;

/** 音声窓はScene時刻に固定する。Effectの内容時刻や描画履歴には依存しない。 */
export function createTimelineAudioInput(renderer: TimelineAudioRenderer, clips: readonly SceneAudioClip[], sceneTimeMs: number, cacheKey: string, isExport: boolean): AudioInput {
	const sampleRate = TIMELINE_AUDIO_INPUT_SAMPLE_RATE;
	// [start, end)のサンプル格子。小数msはここでサンプル位置へ変換し、素材オフセットは丸めない。
	const endFrame = Math.ceil(sceneTimeMs * sampleRate / 1000);
	return {
		cacheKey: JSON.stringify([cacheKey, endFrame, isExport]),
		async readWindow(durationSeconds, signal) {
			signal.throwIfAborted();
			const frames = getAudioWindowFrameCount(durationSeconds, sampleRate);
			const channels = await renderer.renderClips(clips, endFrame - frames, frames, sampleRate, isExport, signal);
			signal.throwIfAborted();
			return { sampleRate, channels };
		},
	};
}
