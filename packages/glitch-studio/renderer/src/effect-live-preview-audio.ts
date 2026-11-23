import { AudioFileReader } from '@gs/subsystems_audio_renderer/audio-file-reader.ts';
import { openAudioFile } from '@gs/subsystems_audio_renderer/audio-file.ts';
import { getAudioWindowFrameCount } from '@gs/subsystems_audio_shared/audio-input.ts';
import { createAudioWindow } from '@gs/subsystems_audio_shared/audio-window.ts';
import type { FileSource } from '@gs/shared/file-source.ts';
import type { AudioInput } from '@gs/subsystems_audio_shared/audio-input.ts';
import type { AudioWindow } from '@gs/subsystems_audio_shared/audio-window.ts';

const sampleRate = 48000;

/** EffectのTIMEと独立した素材時刻で、再生停止中も同じPCMを参照できる。 */
export class EffectLivePreviewAudio {
	private readonly reader: AudioFileReader;
	private pending: Promise<unknown> = Promise.resolve();
	private unavailable = false;

	constructor(file: FileSource) {
		this.reader = new AudioFileReader(() => openAudioFile(file));
	}

	public atTime(position: number, generation: number): AudioInput | null {
		if (this.unavailable) return null;
		const sourceKey = String(generation);
		const endFrame = Math.ceil(position * sampleRate);
		const windows = new Map<number, Promise<AudioWindow>>();
		return {
			cacheKey: `${sourceKey}:${endFrame}`,
			sourceKey,
			sampleRate,
			startFrame: -Infinity,
			endFrame,
			readWindow: (durationSeconds, signal) => {
				const frames = getAudioWindowFrameCount(durationSeconds, sampleRate);
				let window = windows.get(frames);
				if (window != null) return window;
				// 複数のEffectが同じサンプルを並行に要求しても、一つのデコーダーの読み取りは直列に行う。
				window = this.pending.then(async () => {
					signal.throwIfAborted();
					if (!this.unavailable) {
						try {
							const channels = await this.reader.read('preview', (endFrame - frames) / sampleRate, frames, sampleRate, signal);
							return createAudioWindow(sampleRate, channels);
						} catch {
							signal.throwIfAborted();
							// 音声トラックのない動画も映像入力として使える。この素材ではデコードを繰り返さない。
							this.unavailable = true;
						}
					}
					return createAudioWindow(sampleRate, [new Float32Array(frames), new Float32Array(frames)]);
				});
				windows.set(frames, window);
				this.pending = window.catch(() => {});
				return window;
			},
		};
	}

	public dispose() {
		void this.pending.then(() => this.reader.dispose());
	}
}
