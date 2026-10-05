import { WindowedFft } from '@gs/shared/utility/windowed-fft.ts';
import type { AudioChannel } from './audio-spectrum.ts';
import type { AudioInput } from '@gs/subsystems_audio_shared/audio-input.ts';
import type { AudioWindow } from '@gs/subsystems_audio_shared/audio-window.ts';

export interface SpectrumAnalysisRequest {
	// 解析履歴は座標と世代だけを保持する。過去の入力やPCMブロックを引き留めない。
	readonly sourceKey: string;
	readonly sampleRate: number;
	readonly endFrame: number;
	readonly channel: AudioChannel;
	readonly windowName: string;
	readonly firstEndFrame: number;
	readonly lastEndFrame: number;
	readonly durationSeconds: number;
}

/** PCM窓の解析と、描画履歴に依存する指数平滑化。読み出し・待機・描画は呼び出し側が行う。 */
export class AudioInputSpectrum {
	public readonly left: Float32Array;
	public readonly right: Float32Array;
	public hasData = false;
	private sampleRate = 0;
	private fft: WindowedFft | null = null;
	private amplitudes: Float64Array;
	private lastRequest: SpectrumAnalysisRequest | null = null;

	constructor(public readonly size: number) {
		this.left = new Float32Array(size / 2 + 1);
		this.right = new Float32Array(size / 2 + 1);
		this.amplitudes = new Float64Array(size / 2 + 1);
	}

	/** 準備だけでは平滑化も解析位置も進めない。中断された描画を履歴に混ぜないため。 */
	public plan(input: AudioInput, channel: AudioChannel, windowName: string): SpectrumAnalysisRequest | null {
		const hop = this.size / 4;
		const lastEndFrame = Math.floor(input.endFrame / hop) * hop;
		const previous = this.lastRequest;
		const continuous = previous && previous.sourceKey === input.sourceKey
			&& previous.sampleRate === input.sampleRate && previous.endFrame <= input.endFrame
			&& previous.channel === channel && previous.windowName === windowName;
		// 初回・取得元変更・逆方向シークでは最新の1窓から再開する。
		// サンプル格子は常に同じなので、通常再生中の描画fpsが変わってもFFTの区間は変わらない。
		let firstEndFrame = continuous ? previous.lastEndFrame + hop : lastEndFrame;
		// 長い停止・前方シークで際限なく追いつかない。捨てた区間の平滑化は再現しない。
		firstEndFrame = Math.max(firstEndFrame, lastEndFrame - 127 * hop);
		// Playerが既に捨てた履歴を大量の無音として解析しない。1窓に満たない場合だけゼロ補完する。
		firstEndFrame = Math.max(firstEndFrame, Math.min(lastEndFrame, Math.ceil((input.startFrame + this.size) / hop) * hop));
		if (firstEndFrame > lastEndFrame) return null;
		return {
			sourceKey: input.sourceKey, sampleRate: input.sampleRate, endFrame: input.endFrame,
			channel, windowName, firstEndFrame, lastEndFrame,
			durationSeconds: (input.endFrame - firstEndFrame + this.size) / input.sampleRate,
		};
	}

	public update(request: SpectrumAnalysisRequest, window: AudioWindow, smoothing: number) {
		if (this.lastRequest === request) return;
		const { sampleRate, channel, windowName } = request;
		if (!this.fft || this.fft.windowName !== windowName) this.fft = new WindowedFft(this.size, windowName);
		// レート変更もFFTサイズ変更と同じく各binの周波数が変わるため、添字のまま引き継がない。
		if (this.sampleRate !== sampleRate) {
			this.left.fill(0);
			this.right.fill(0);
			this.hasData = false;
			this.sampleRate = sampleRate;
		}
		const hop = this.size / 4;
		// 時刻差ではなく、処理した音声サンプル数に対する時定数。逆方向シークでも負にならない。
		const alpha = smoothing > 0 ? Math.exp(-hop / sampleRate / smoothing) : 0;
		const startFrame = request.endFrame - window.frameCount;
		for (let endFrame = request.firstEndFrame; endFrame <= request.lastEndFrame; endFrame += hop) {
			for (let side = 0; side < (channel === 'stereo' ? 2 : 1); side++) {
				const selected = channel === 'stereo' ? (side === 0 ? 'left' : 'right') : channel;
				this.fft.transform(index => {
					const frame = endFrame - this.size + index - startFrame;
					return window.sample(frame, selected);
				}, this.amplitudes);
				const output = side === 0 ? this.left : this.right;
				for (let bin = 0; bin < output.length; bin++) output[bin] = output[bin] * alpha + this.amplitudes[bin] * (1 - alpha);
			}
		}
		this.hasData = true;
		this.lastRequest = request;
	}

	/** 未選択中は呼び出し側で透明にし、再選択時には平滑化の値を保持して解析位置だけ取り直す。 */
	public disconnect() { this.lastRequest = null; }
}
