import type { SceneAudioClip } from '@gs/subsystems_timeline_shared/scene-audio.ts';
import type { ParameterEvaluationScope } from '@gs/shared/parameter/parameter-evaluation-scope.ts';
import type { TimelineParameterBinding } from '@gs/subsystems_timeline_shared/types.ts';
import { TimelineParameterBindingEvaluator } from '@gs/subsystems_timeline_shared/parameter-binding-evaluator.ts';
import { createTimelineLayerEvaluationScope } from '@gs/subsystems_timeline_shared/evaluation-scope.ts';
import { timelineAudioParamDefs } from '@gs/subsystems_timeline_shared/timeline-audio.ts';
import { coerceParameterValue } from '@gs/shared/parameter/coerce-parameter-value.ts';
import type { StereoPcm, AudioPcmReadOptions } from '@gs/subsystems_audio_shared/pcm.ts';
import { getTimelineMediaCycle, getTimelineMediaPeriod, getTimelineMediaSourceTime } from '@gs/subsystems_timeline_shared/media-timing.ts';

/** 指定素材時刻（秒）から、指定レートでframes個ずつの左右PCMを返す。素材外は無音とする。 */
export type AudioPcmReader = (sourceId: string, timeSeconds: number, frames: number, sampleRate: number, signal?: AbortSignal, options?: AudioPcmReadOptions) => Promise<StereoPcm>;

function frameAtOrAfter(timeMs: number, sampleRate: number): number {
	const position = timeMs * sampleRate / 1000;
	const nearest = Math.round(position);
	// 子Sceneの小数オフセットの加減算で、整数サンプル境界がわずかにずれる。
	// この誤差だけを吸収し、境界直後の1サンプルを前の周から読まないようにする。
	return Math.abs(position - nearest) <= 4 * Number.EPSILON * Math.max(1, Math.abs(position)) ? nearest : Math.ceil(position);
}

/** DOM・GPU・再生状態を持たない。書き出しも独立インスタンスで同じPCMを生成できる。 */
export class TimelineAudioRenderer {
	private evaluator = new TimelineParameterBindingEvaluator();

	constructor(private read: AudioPcmReader) {}

	async renderClips(clips: readonly SceneAudioClip[], startFrame: number, frames: number, sampleRate: number, isExport = false, signal?: AbortSignal): Promise<StereoPcm> {
		signal?.throwIfAborted();
		const output: StereoPcm = [new Float32Array(frames), new Float32Array(frames)];
		for (const clip of clips) {
			signal?.throwIfAborted();
			const first = Math.max(startFrame, frameAtOrAfter(clip.startMs, sampleRate));
			const end = Math.min(startFrame + frames, frameAtOrAfter(clip.endMs, sampleRate));
			if (end <= first) continue;
			const gains = clip.gains.map(gain => ({
				sceneStartMs: gain.sceneStartMs,
				evaluate: this.createGain(gain.volume, time => createTimelineLayerEvaluationScope({
					time,
					automationGraphs: gain.automationGraphs,
					isExport,
				})),
			}));
			for (let partStart = first; partStart < end;) {
				let partEnd = end;
				const timing = clip.sourceTiming;
				const timeMs = partStart / sampleRate * 1000;
				let sourceTimeMs = getTimelineMediaSourceTime(timing, timeMs);
				if (timing.loop) {
					// 各周期の境界を絶対サンプル位置から求める。周期をサンプル数に丸めて
					// 足し続けると44.1kHzなどで周回ごとに音声と映像の位置がずれてしまう。
					const period = getTimelineMediaPeriod(timing);
					let cycle = getTimelineMediaCycle(timing, timeMs);
					// 時刻の減算が境界の直前へ丸まった場合も、絶対サンプル位置を優先する。
					if (frameAtOrAfter(timing.startMs + (cycle + 1) * period, sampleRate) <= partStart) cycle++;
					sourceTimeMs = (timing.playbackRate > 0 ? timing.sourceInMs : timing.sourceOutMs)
						+ Math.max(0, timeMs - timing.startMs - cycle * period) * timing.playbackRate;
					partEnd = Math.min(end, Math.max(partStart + 1, frameAtOrAfter(timing.startMs + (cycle + 1) * period, sampleRate)));
				}
				const pcm = await this.read(clip.sourceId, sourceTimeMs / 1000, partEnd - partStart, sampleRate, signal,
					{ playbackRate: timing.playbackRate, sourceStartSeconds: timing.sourceInMs / 1000, sourceEndSeconds: timing.sourceOutMs / 1000 });
				// 読み取り側が即時中断できなくても、古い要求をミックスしない。
				signal?.throwIfAborted();
				for (let frame = partStart; frame < partEnd; frame++) {
					const time = frame / sampleRate * 1000;
					// 音量は周期の先頭に戻さず、所属Sceneの時計で連続して評価する。
					const gain = gains.reduce((value, control) => value * control.evaluate(time - control.sceneStartMs), 1);
					for (let channel = 0; channel < 2; channel++) output[channel][frame - startFrame] += pcm[channel][frame - partStart] * gain;
				}
				partStart = partEnd;
			}
		}
		// 子Sceneごとにはクリップせず、すべての音声を浮動小数点のまま加算する。
		return output;
	}

	private createGain(binding: TimelineParameterBinding, getScope: (time: number) => ParameterEvaluationScope) {
		const cache = new Map<number, number>();
		const evaluate = (time: number) => {
			const value = coerceParameterValue(timelineAudioParamDefs.volume, this.evaluator.evaluate(binding, getScope(time), 0, timelineAudioParamDefs.volume));
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
