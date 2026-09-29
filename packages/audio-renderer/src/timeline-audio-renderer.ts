import { ParameterEvaluator } from '@glitch/shared/parameter-evaluator.js';
import type { TimelineAudioLayer } from '@glitch/shared/timeline/types.ts';
import type { StereoPcm } from './pcm.ts';

export type AudioPcmReader = (assetId: string, timeSeconds: number, frames: number, sampleRate: number) => Promise<StereoPcm>;

/** DOM・GPU・再生状態を持たない。書き出しも独立インスタンスで同じPCMを生成できる。 */
export class TimelineAudioRenderer {
	private evaluator = new ParameterEvaluator();

	constructor(private read: AudioPcmReader) {}

	async render(layers: readonly TimelineAudioLayer[], startFrame: number, frames: number, sampleRate: number, isExport = false): Promise<StereoPcm> {
		const output: StereoPcm = [new Float32Array(frames), new Float32Array(frames)];
		for (const layer of layers) {
			const first = Math.max(startFrame, Math.ceil(layer.startTimeMs * sampleRate / 1000));
			const end = Math.min(startFrame + frames, Math.ceil(layer.endTimeMs * sampleRate / 1000));
			if (end <= first) continue;
			const pcm = await this.read(layer.assetId, (first / sampleRate * 1000 - layer.startTimeMs + layer.sourceOffsetMs) / 1000, end - first, sampleRate);
			const duration = layer.endTimeMs - layer.startTimeMs;
			const binding = layer.paramValues.volume;
			const cache = new Map<number, number>();
			const evaluate = (time: number) => {
				const value = this.evaluator.evaluate(binding, {
					time, endTime: duration, automationGraphs: layer.automationGraphs, evaluatedParamValues: null,
					variables: { TIME: time / 1000, TIME_MS: time, END_TIME: duration / 1000, END_TIME_MS: duration, PROGRESS: time / duration, IS_EXPORT: isExport },
				}, 0);
				return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
			};
			const control = (index: number) => {
				if (!cache.has(index)) cache.set(index, evaluate(index * 5));
				return cache.get(index)!;
			};
			for (let frame = first; frame < end; frame++) {
				const localTime = frame / sampleRate * 1000 - layer.startTimeMs;
				// 式は200Hzの固定グリッドで評価する。チャンク境界・FPS・先読み量に依存しない。
				// キーフレームはhold境界をぼかさないよう、サンプル時刻で直接評価する。
				const index = Math.floor(localTime / 5);
				const fraction = localTime / 5 - index;
				const gain = binding.inputSource === 'keyframesTimelineInline' ? evaluate(localTime)
					: control(index) * (1 - fraction) + control(index + 1) * fraction;
				for (let channel = 0; channel < 2; channel++) {
					output[channel][frame - startFrame] += pcm[channel][frame - first] * gain;
				}
			}
		}
		// 各レイヤーではクリップせず加算する。ハードウェア出力の飽和とは区別する。
		return output;
	}
}
