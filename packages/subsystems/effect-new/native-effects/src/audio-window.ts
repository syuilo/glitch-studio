import type { AudioInput } from '@gs/subsystems_audio_shared/audio-input.ts';
import type { AudioWindow } from '@gs/subsystems_audio_shared/audio-window.ts';

/** ライブ入力は同期で取得し、非同期のファイル窓だけフレーム準備で待つ。 */
export function createAudioWindowReader() {
	let cacheKey: string | null = null;
	let windowDuration = 0;
	let window: AudioWindow | null = null;
	return {
		get window() { return window; },
		prepare(input: AudioInput | null, duration: number, signal: AbortSignal) {
			const nextKey = input?.cacheKey ?? null;
			if (nextKey === cacheKey && duration === windowDuration) return;
			const result = input?.readWindow(duration, signal) ?? null;
			const accept = (value: AudioWindow | null) => {
				signal.throwIfAborted();
				window = value;
				cacheKey = nextKey;
				windowDuration = duration;
			};
			if (result instanceof Promise) return result.then(accept);
			return accept(result);
		},
	};
}
