import type { SceneAudioClip } from '@gs/subsystems_timeline_shared/scene-audio.ts';
import type { ParameterEvaluationScope } from '@gs/shared/parameter/parameter-evaluation-scope.ts';
import type { TimelineParameterBinding } from '@gs/subsystems_timeline_shared/types.ts';
import { getTimelineClipEnd } from '@gs/subsystems_timeline_shared/timing.ts';
import { TimelineParameterBindingEvaluator } from '@gs/subsystems_timeline_shared/parameter-binding-evaluator.ts';
import { createTimelineLayerEvaluationScope } from '@gs/subsystems_timeline_shared/evaluation-scope.ts';
import type { TimelineAudioLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { StereoPcm } from './pcm.ts';

export type AudioPcmReader = (assetId: string, timeSeconds: number, frames: number, sampleRate: number) => Promise<StereoPcm>;
export type AudioDurationReader = (assetId: string, basis?: 'audio' | 'media') => Promise<number>;

/** DOM・GPU・再生状態を持たない。書き出しも独立インスタンスで同じPCMを生成できる。 */
export class TimelineAudioRenderer {
	private evaluator = new TimelineParameterBindingEvaluator();

	constructor(private read: AudioPcmReader, private getDurationMs: AudioDurationReader) {}

	async render(layers: readonly TimelineAudioLayer[], startFrame: number, frames: number, sampleRate: number, isExport = false): Promise<StereoPcm> {
		return this.renderClips(layers.filter(layer => !layer.isDisabled).flatMap(layer => layer.clips.map(clip => ({ assetId: clip.assetId, durationBasis: 'audio' as const,
			sourceStartMs: clip.startMs - clip.contentOffsetMs, startMs: clip.startMs, endMs: getTimelineClipEnd(clip),
			gains: [{ sceneStartMs: 0, volume: layer.audioParamValues.volume, automationGraphs: layer.automationGraphs }],
		}))), startFrame, frames, sampleRate, isExport);
	}

	async renderClips(clips: readonly SceneAudioClip[], startFrame: number, frames: number, sampleRate: number, isExport = false): Promise<StereoPcm> {
		const output: StereoPcm = [new Float32Array(frames), new Float32Array(frames)];
		for (const clip of clips) {
			const first = Math.max(startFrame, Math.ceil(clip.startMs * sampleRate / 1000));
			const end = Math.min(startFrame + frames, Math.ceil(clip.endMs * sampleRate / 1000));
			if (end <= first) continue;
			const duration = await this.getDurationMs(clip.assetId, clip.durationBasis);
			if (!Number.isFinite(duration) || duration <= 0) throw new Error('Audio has no finite duration.');
			const pcm = await this.read(clip.assetId, (first / sampleRate * 1000 - clip.sourceStartMs) / 1000, end - first, sampleRate);
			const gains = clip.gains.map(gain => ({ sceneStartMs: gain.sceneStartMs,
				evaluate: this.createGain(gain.volume, time => createTimelineLayerEvaluationScope({
					time, automationGraphs: gain.automationGraphs, isExport,
				})),
			}));
			for (let frame = first; frame < end; frame++) {
				const time = frame / sampleRate * 1000;
				// 各階層の音量は所属Sceneの時刻で評価する。素材の内容時刻と混同しない。
				const gain = gains.reduce((value, control) => value * control.evaluate(time - control.sceneStartMs), 1);
				for (let channel = 0; channel < 2; channel++) output[channel][frame - startFrame] += pcm[channel][frame - first] * gain;
			}
		}
		// 子Sceneごとにはクリップせず、すべての音声を浮動小数点のまま加算する。
		return output;
	}

	private createGain(binding: TimelineParameterBinding, getScope: (time: number) => ParameterEvaluationScope) {
		const cache = new Map<number, number>();
		const evaluate = (time: number) => {
			const value = this.evaluator.evaluate(binding, getScope(time), 0);
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
