import { AudioFileReader } from '@gs/subsystems_audio_renderer/audio-file-reader.ts';
import { openAudioFile } from '@gs/subsystems_audio_renderer/audio-file.ts';
import { AudioHistory } from '@gs/subsystems_audio_renderer/audio-history.ts';
import { getAudioWindowFrameCount } from '@gs/subsystems_audio_shared/audio-input.ts';
import { createAudioWindow } from '@gs/subsystems_audio_shared/audio-window.ts';
import type { FileSource } from '@gs/shared/file-source.ts';
import type { AudioCaptureMessage } from '@gs/subsystems_audio_shared/audio-capture.ts';
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

/** ライブ入力のPCMは最新のキャプチャ位置で固定する。Effectの時計や素材の再生位置は使わない。 */
export class EffectLivePreviewAudioCapture {
	private readonly history = new AudioHistory();
	private input: AudioInput | null = null;

	constructor(private readonly port: MessagePort, private readonly sourceGeneration: number) {
		port.onmessage = ({ data }: MessageEvent<AudioCaptureMessage>) => {
			if (data.type === 'reset') {
				this.history.reset(data.generation);
			} else {
				try { this.history.append(data); } finally {
					port.postMessage({ type: 'recycle', buffer: data.buffer }, [data.buffer]);
				}
			}
		};
	}

	public snapshot(): AudioInput | null {
		const { channelCount, endFrame, revision } = this.history;
		if (channelCount === 0) return null;
		// 音声の連続区間が変わったら、時刻が同じ場合もスペクトログラムの蓄積を切り替える。
		const sourceKey = `capture:${this.sourceGeneration}:${revision}`;
		const cacheKey = `${sourceKey}:${endFrame}`;
		if (this.input?.cacheKey === cacheKey) return this.input;
		const snapshot = this.history.snapshot();
		const { sampleRate, startFrame } = snapshot;
		this.input = {
			sourceKey, cacheKey, sampleRate, startFrame, endFrame,
			readWindow(durationSeconds, signal) {
				signal.throwIfAborted();
				return snapshot.readWindow(getAudioWindowFrameCount(durationSeconds, sampleRate));
			},
		};
		return this.input;
	}

	public dispose() {
		this.port.onmessage = null;
		this.port.close();
		this.history.reset();
		this.input = null;
	}
}
