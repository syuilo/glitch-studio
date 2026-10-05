import { WindowedFft } from './windowed-fft.ts';
import type { AudioHistory } from '../audio-history.ts';

export type AudioChannel = 'left' | 'right' | 'mix' | 'stereo';

export function finiteNumber(value: number, fallback: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));
}

export function audioChannel(value: string): AudioChannel {
	return value === 'right' || value === 'mix' || value === 'stereo' ? value : 'left';
}

export class AudioSpectrum {
	public left: Float32Array;
	public right: Float32Array;
	public hasData = false;
	private fft: WindowedFft;
	private amplitudes: Float64Array;
	private history: AudioHistory | null = null;
	private revision = -1;
	private nextEndFrame = 0;
	private channel: AudioChannel = 'left';

	constructor(public readonly size: number, public readonly windowName: string) {
		this.left = new Float32Array(size / 2 + 1);
		this.right = new Float32Array(size / 2 + 1);
		this.fft = new WindowedFft(size, windowName);
		this.amplitudes = new Float64Array(size / 2 + 1);
	}

	private transform(history: AudioHistory, endFrame: number, channel: 'left' | 'right' | 'mix', output: Float32Array, alpha: number) {
		this.fft.transform(index => history.sample(endFrame - this.size + index, channel), this.amplitudes);
		for (let i = 0; i < output.length; i++) output[i] = output[i] * alpha + this.amplitudes[i] * (1 - alpha);
	}

	public update(history: AudioHistory | null, channel: AudioChannel, smoothing: number,
		onFrame?: (endFrame: number, reset: boolean) => void) {
		const hop = this.size / 4;
		if (this.history !== history || this.revision !== history?.revision || this.channel !== channel
			|| (history && this.nextEndFrame - this.size < history.startFrame)) {
			this.left.fill(0);
			this.right.fill(0);
			this.hasData = false;
			this.history = history;
			this.revision = history?.revision ?? -1;
			this.channel = channel;
			this.nextEndFrame = (history?.startFrame ?? 0) + this.size;
		}
		if (!history?.channelCount) return;
		// 長時間停止した描画の追いつきで音声履歴を無制限に解析しない。
		const pending = Math.floor((history.endFrame - this.nextEndFrame) / hop) + 1;
		if (pending > 128) {
			this.nextEndFrame += (pending - 128) * hop;
			this.left.fill(0);
			this.right.fill(0);
			this.hasData = false;
		}
		// 描画fpsではなく、解析するサンプル間隔に基づく時定数。
		const alpha = smoothing > 0 ? Math.exp(-hop / history.sampleRate / smoothing) : 0;
		while (this.nextEndFrame <= history.endFrame) {
			this.transform(history, this.nextEndFrame, channel === 'stereo' ? 'left' : channel, this.left, alpha);
			if (channel === 'stereo') this.transform(history, this.nextEndFrame, 'right', this.right, alpha);
			// 各解析区間を通知し、低fpsでも途中のスペクトラムを履歴へ残せるようにする。
			onFrame?.(this.nextEndFrame, !this.hasData);
			this.nextEndFrame += hop;
			this.hasData = true;
		}
	}
}
