import type { SceneAudioClip } from '@glitch/shared/timeline/scene-audio.ts';
import type { EvaluationScope } from '@glitch/shared/parameter-evaluator.ts';
import type { TimelineParameterBinding } from '@glitch/shared/timeline/types.ts';
import { getTimelineLayerStart, getTimelineLayerEnd } from '@glitch/shared/timeline/timing.ts';
import { ParameterEvaluator } from '@glitch/shared/parameter-evaluator.js';
import { createAudioLayerEvaluationScope, createTimelineLayerEvaluationScope } from '@glitch/shared/timeline/evaluation-scope.ts';
import type { TimelineAudioLayer } from '@glitch/shared/timeline/types.ts';
import type { StereoPcm } from './pcm.ts';

export type AudioPcmReader = (assetId: string, timeSeconds: number, frames: number, sampleRate: number) => Promise<StereoPcm>;
export type AudioDurationReader = (assetId: string, basis?: 'audio' | 'media') => Promise<number>;

/** DOM・GPU・再生状態を持たない。書き出しも独立インスタンスで同じPCMを生成できる。 */
export class TimelineAudioRenderer {
	private evaluator = new ParameterEvaluator();

	constructor(private read: AudioPcmReader, private getDurationMs: AudioDurationReader) {}

	async render(layers: readonly TimelineAudioLayer[], startFrame: number, frames: number, sampleRate: number, isExport = false): Promise<StereoPcm> {
		return this.renderClips(layers.map(layer => ({ assetId: layer.assetId, volume: layer.paramValues.volume, automationGraphs: layer.automationGraphs, durationBasis: 'audio', positionMs: layer.positionMs,
			startMs: getTimelineLayerStart(layer), endMs: getTimelineLayerEnd(layer), gains: [] })), startFrame, frames, sampleRate, isExport);
	}

	async renderClips(clips: readonly SceneAudioClip[], startFrame: number, frames: number, sampleRate: number, isExport = false): Promise<StereoPcm> {
		const output: StereoPcm = [new Float32Array(frames), new Float32Array(frames)];
		for (const clip of clips) {
			const first = Math.max(startFrame, Math.ceil(clip.startMs * sampleRate / 1000));
			const end = Math.min(startFrame + frames, Math.ceil(clip.endMs * sampleRate / 1000));
			if (end <= first) continue;
			const duration = await this.getDurationMs(clip.assetId, clip.durationBasis);
			if (!Number.isFinite(duration) || duration <= 0) throw new Error('Audio has no finite duration.');
			const pcm = await this.read(clip.assetId, (first / sampleRate * 1000 - clip.positionMs) / 1000, end - first, sampleRate);
			const gains = [
				{ positionMs: clip.positionMs, evaluate: this.createGain(clip.volume, time => createAudioLayerEvaluationScope({
					time, endTime: duration, automationGraphs: clip.automationGraphs, isExport,
				})) },
				// Scene配置の音量は映像の合成設定と同じスコープを使う。
				...clip.gains.map(gain => ({ positionMs: gain.positionMs,
					evaluate: this.createGain(gain.volume, time => createTimelineLayerEvaluationScope({
						time, endTime: gain.endTimeMs, automationGraphs: gain.automationGraphs, isExport,
					})) })),
			];
			for (let frame = first; frame < end; frame++) {
				const time = frame / sampleRate * 1000;
				// 各階層の音量はそれぞれの内容時刻で評価する。祖先のトリムでキーを移動しない。
				const gain = gains.reduce((value, control) => value * control.evaluate(time - control.positionMs), 1);
				for (let channel = 0; channel < 2; channel++) output[channel][frame - startFrame] += pcm[channel][frame - first] * gain;
			}
		}
		// 子Sceneごとにはクリップせず、すべての音声を浮動小数点のまま加算する。
		return output;
	}

	private createGain(binding: TimelineParameterBinding, getScope: (time: number) => EvaluationScope) {
		const cache = new Map<number, number>();
		const evaluate = (time: number) => {
			const value = this.evaluator.evaluate(binding, {
				...getScope(time), evaluatedParamValues: null,
			}, 0);
			return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
		};
		const control = (index: number) => {
			if (!cache.has(index)) cache.set(index, evaluate(index * 5));
			return cache.get(index)!;
		};
		return (time: number) => {
			// 固定200HzグリッドはチャンクやFPSに依存しない。holdキーはサンプル時刻で直接評価する。
			if (binding.inputSource === 'keyframesTimelineInline') return evaluate(time);
			const index = Math.floor(time / 5);
			const fraction = time / 5 - index;
			return control(index) * (1 - fraction) + control(index + 1) * fraction;
		};
	}
}
