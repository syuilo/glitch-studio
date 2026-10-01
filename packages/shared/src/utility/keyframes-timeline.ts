import type { ParameterBinding } from '../types.ts';
import { supportsKeyframeInterpolation } from '../keyframes-timeline.ts';

type InlineKeyframesTimeline = Extract<ParameterBinding, { inputSource: 'keyframesTimelineInline' }>;

export function evaluateKeyframesTimeline<T>(input: InlineKeyframesTimeline, time: number, endTime: number, fallback: T): number | number[] | string | boolean | T {
	const timeline = input.keyframesTimeline;
	// 同じ時刻では元の配列で後にあるキーフレームを優先する。保存データは変更しない。
	const keyframes = timeline.keyframes.toSorted((a, b) => a.x - b.x);
	if (keyframes.length === 0) return fallback;
	const first = keyframes[0];
	const last = keyframes[keyframes.length - 1];
	const scale = timeline.isNormalized
		? (input.trimmedDurationMs != null && Number.isFinite(input.trimmedDurationMs) && input.trimmedDurationMs > 0 ? input.trimmedDurationMs : 1000)
		: 1;
	let x = input.offsetMode === 'end' && Number.isFinite(endTime)
		? (time - endTime) / scale + last.x
		: time / scale;
	const duration = last.x - first.x;
	let value: number | number[] | string | boolean;
	if (duration === 0) {
		value = last.value;
	} else {
		switch (input.wrapMode) {
			case 'clamp': x = Math.max(first.x, Math.min(last.x, x)); break;
			case 'repeat': {
				const offset = (x - first.x) % duration;
				x = first.x + (offset < 0 ? offset + duration : offset);
				break;
			}
			case 'repeatMirrored': {
				const period = duration * 2;
				const offset = (x - first.x) % period;
				const phase = offset < 0 ? offset + period : offset;
				x = first.x + (phase <= duration ? phase : period - phase);
				break;
			}
		}
		const previous = keyframes.findLast(keyframe => keyframe.x <= x);
		const next = keyframes.find(keyframe => keyframe.x > x);
		if (previous == null) {
			value = first.value;
		} else if (next == null || previous.x === x || previous.interpolation.type === 'hold' || !supportsKeyframeInterpolation(timeline.dataType)) {
			value = previous.value;
		} else {
			const progress = (x - previous.x) / (next.x - previous.x);
			const from = previous.value;
			const to = next.value;
			if (typeof from === 'number' && typeof to === 'number') {
				value = from + (to - from) * progress;
			} else if (Array.isArray(from) && Array.isArray(to)) {
				value = from.map((component, i) => component + (to[i] - component) * progress);
			} else {
				return fallback;
			}
		}
	}
	// 保存配列を呼び出し側の変更から保護する。色は未乗算のまま変換境界へ渡す。
	return Array.isArray(value) ? [...value] : value;
}
