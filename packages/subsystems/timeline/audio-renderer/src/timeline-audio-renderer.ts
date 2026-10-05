import type { SceneAudioClip } from '@gs/subsystems_timeline_shared/scene-audio.ts';
import type { ParameterEvaluationScope } from '@gs/shared/parameter/parameter-evaluation-scope.ts';
import type { TimelineParameterBinding } from '@gs/subsystems_timeline_shared/types.ts';
import { TimelineParameterBindingEvaluator } from '@gs/subsystems_timeline_shared/parameter-binding-evaluator.ts';
import { createTimelineLayerEvaluationScope } from '@gs/subsystems_timeline_shared/evaluation-scope.ts';
import { timelineAudioParamDefs } from '@gs/subsystems_timeline_shared/timeline-audio.ts';
import { coerceParameterValue } from '@gs/shared/parameter/coerce-parameter-value.ts';
import type { StereoPcm } from '@gs/subsystems_audio_shared/pcm.ts';

/** 指定素材時刻（秒）から、指定レートでframes個ずつの左右PCMを返す。素材外は無音とする。 */
export type AudioPcmReader = (assetId: string, timeSeconds: number, frames: number, sampleRate: number, signal?: AbortSignal) => Promise<StereoPcm>;

/** DOM・GPU・再生状態を持たない。書き出しも独立インスタンスで同じPCMを生成できる。 */
export class TimelineAudioRenderer {
	private evaluator = new TimelineParameterBindingEvaluator();

	constructor(private read: AudioPcmReader) {}

	async renderClips(clips: readonly SceneAudioClip[], startFrame: number, frames: number, sampleRate: number, isExport = false, signal?: AbortSignal): Promise<StereoPcm> {
		signal?.throwIfAborted();
		const output: StereoPcm = [new Float32Array(frames), new Float32Array(frames)];
		for (const clip of clips) {
			signal?.throwIfAborted();
			const first = Math.max(startFrame, Math.ceil(clip.startMs * sampleRate / 1000));
			const end = Math.min(startFrame + frames, Math.ceil(clip.endMs * sampleRate / 1000));
			if (end <= first) continue;
			const pcm = await this.read(clip.assetId, (first / sampleRate * 1000 - clip.sourceStartMs) / 1000, end - first, sampleRate, signal);
			// 読み取り側が即時中断できなくても、古い要求のミックスや残りの素材取得は進めない。
			signal?.throwIfAborted();
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
			const value = coerceParameterValue(timelineAudioParamDefs.volume, this.evaluator.evaluate(binding, getScope(time), 0));
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
