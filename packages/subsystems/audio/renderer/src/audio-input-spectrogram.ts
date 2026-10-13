import { WindowedFft } from '@gs/shared/utility/windowed-fft.ts';
import type { AudioChannel } from './audio-spectrum.ts';
import type { AudioInput } from '@gs/subsystems_audio_shared/audio-input.ts';
import type { AudioWindow } from '@gs/subsystems_audio_shared/audio-window.ts';

export type SpectrogramAnalysisSettings = {
	readonly fftSize: number;
	readonly windowName: string;
	readonly channel: AudioChannel;
	readonly smoothing: number;
};

export interface SpectrogramAnalysisRequest extends SpectrogramAnalysisSettings {
	// 解析履歴にはメタデータだけを残し、過去の入力やPCMを保持しない。
	readonly sourceKey: string;
	readonly sampleRate: number;
	readonly endFrame: number;
	readonly firstEndFrame: number;
	readonly lastEndFrame: number;
	readonly reset: boolean;
	/** 新しいFFT区間がない場合はnull。読み出しなしで描画時刻だけを記録する。 */
	readonly durationSeconds: number | null;
}

/** Spectrogram用の差分解析。PCMの取得と、各FFT区間の表示・保持は呼び出し側が所有する。 */
export class AudioInputSpectrogram {
	private fft: WindowedFft | null = null;
	private amplitudes = new Float64Array(0);
	private left = new Float32Array(0);
	private right = new Float32Array(0);
	private lastRequest: SpectrogramAnalysisRequest | null = null;

	/** 準備中は状態を変えない。キャンセルされたシークや設定変更を履歴へ採用しないため。 */
	public plan(input: AudioInput, settings: SpectrogramAnalysisSettings, restart: boolean): SpectrogramAnalysisRequest {
		const { fftSize, windowName, channel, smoothing } = settings;
		const hop = fftSize / 4;
		const lastEndFrame = Math.floor(input.endFrame / hop) * hop;
		const previous = this.lastRequest;
		const continuous = !restart && previous != null && previous.sourceKey === input.sourceKey
			&& previous.sampleRate === input.sampleRate && previous.endFrame <= input.endFrame
			&& previous.fftSize === fftSize && previous.windowName === windowName
			&& previous.channel === channel && previous.smoothing === smoothing;
		// 初回・入力変更・逆方向シークでは最新の1窓から再開する。
		// Scene時刻のサンプル格子を使い、描画FPSによってFFT区間がずれないようにする。
		const nextEndFrame = continuous ? previous!.lastEndFrame + hop : lastEndFrame;
		const firstEndFrame = Math.max(nextEndFrame, lastEndFrame - 127 * hop,
			Math.min(lastEndFrame, Math.ceil((input.startFrame + fftSize) / hop) * hop));
		return {
			...settings, sourceKey: input.sourceKey, sampleRate: input.sampleRate, endFrame: input.endFrame,
			firstEndFrame, lastEndFrame,
			// 追いつきを省略した場合も、欠落区間を連続した履歴として表示しない。
			reset: !continuous || firstEndFrame > nextEndFrame,
			durationSeconds: firstEndFrame <= lastEndFrame ? (input.endFrame - firstEndFrame + fftSize) / input.sampleRate : null,
		};
	}

	public update(request: SpectrogramAnalysisRequest, window: AudioWindow | null,
		onFrame: (endFrame: number, reset: boolean, left: Float32Array, right: Float32Array) => void) {
		if (this.lastRequest === request || (request.durationSeconds != null && window == null)) return;
		const { fftSize, windowName, channel, smoothing, sampleRate } = request;
		if (this.fft == null || this.fft.size !== fftSize || this.fft.windowName !== windowName) {
			this.fft = new WindowedFft(fftSize, windowName);
			this.amplitudes = new Float64Array(fftSize / 2 + 1);
			this.left = new Float32Array(fftSize / 2 + 1);
			this.right = new Float32Array(fftSize / 2 + 1);
		}
		if (request.reset) {
			this.left.fill(0);
			this.right.fill(0);
		}
		const hop = fftSize / 4;
		// 指数平滑化は描画間隔ではなく、解析したサンプル数に対する時定数で進める。
		const alpha = smoothing > 0 ? Math.exp(-hop / sampleRate / smoothing) : 0;
		const startFrame = request.endFrame - (window?.frameCount ?? 0);
		for (let endFrame = request.firstEndFrame; endFrame <= request.lastEndFrame; endFrame += hop) {
			for (let side = 0; side < (channel === 'stereo' ? 2 : 1); side++) {
				const selected = channel === 'stereo' ? (side === 0 ? 'left' : 'right') : channel;
				this.fft.transform(index => window!.sample(endFrame - fftSize + index - startFrame, selected), this.amplitudes);
				const output = side === 0 ? this.left : this.right;
				for (let bin = 0; bin < output.length; bin++) output[bin] = output[bin] * alpha + this.amplitudes[bin] * (1 - alpha);
			}
			// 最新区間だけでなく途中の区間も通知し、低FPSでも時間軸の情報を残す。
			onFrame(endFrame, request.reset && endFrame === request.firstEndFrame, this.left, this.right);
		}
		// FFTが増えない描画も時刻を採用する。同じhop内の逆方向シークを検出するため。
		this.lastRequest = request;
	}

	public reset() {
		this.lastRequest = null;
		this.left.fill(0);
		this.right.fill(0);
	}
}
