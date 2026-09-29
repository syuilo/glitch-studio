import { getTimelineLayerStart, getTimelineLayerEnd, getTimelineLayerContentTime } from '@glitch/shared/timeline/timing.ts';
import { ParameterEvaluator } from '@glitch/shared/parameter-evaluator.js';
import type { TimelineAudioLayer } from '@glitch/shared/timeline/types.ts';
import type { StereoPcm } from './pcm.ts';

export type AudioPcmReader = (assetId: string, timeSeconds: number, frames: number, sampleRate: number) => Promise<StereoPcm>;
export type AudioDurationReader = (assetId: string) => Promise<number>;

/** DOM・GPU・再生状態を持たない。書き出しも独立インスタンスで同じPCMを生成できる。 */
export class TimelineAudioRenderer {
	private evaluator = new ParameterEvaluator();

	constructor(private read: AudioPcmReader, private getDurationMs: AudioDurationReader) {}

	async render(layers: readonly TimelineAudioLayer[], startFrame: number, frames: number, sampleRate: number, isExport = false): Promise<StereoPcm> {
		const output: StereoPcm = [new Float32Array(frames), new Float32Array(frames)];
		for (const layer of layers) {
			const playbackStartMs = getTimelineLayerStart(layer);
			const first = Math.max(startFrame, Math.ceil(playbackStartMs * sampleRate / 1000));
			const end = Math.min(startFrame + frames, Math.ceil(getTimelineLayerEnd(layer) * sampleRate / 1000));
			if (end <= first) continue;
			// 音声のEND_TIMEは素材自身の長さ。両端をトリムしても評価の基準を変えない。
			const duration = await this.getDurationMs(layer.assetId);
			if (!Number.isFinite(duration) || duration <= 0) throw new Error('Audio has no finite duration.');
			const pcm = await this.read(layer.assetId, getTimelineLayerContentTime(layer, first / sampleRate * 1000) / 1000, end - first, sampleRate);
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
				const localTime = getTimelineLayerContentTime(layer, frame / sampleRate * 1000);
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
