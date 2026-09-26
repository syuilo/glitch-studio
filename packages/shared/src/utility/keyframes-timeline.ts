import type { ParameterBinding } from '../types.ts';

type InlineKeyframesTimeline = Extract<ParameterBinding, { inputSource: 'keyframesTimelineInline' }>;

export function evaluateKeyframesTimeline<T>(input: InlineKeyframesTimeline, time: number, endTime: number, fallback: T): number | number[] | T {
	const timeline = input.keyframesTimeline;
	// 同じ時刻では元の配列で後にあるキーフレームを優先する。保存データは変更しない。
	const keyframes = timeline.keyframes.toSorted((a, b) => a.x - b.x);
	if (keyframes.length === 0) return fallback;
	const first = keyframes[0];
	const last = keyframes[keyframes.length - 1];
	const scale = timeline.isNormalized
		? (input.durationMs != null && Number.isFinite(input.durationMs) && input.durationMs > 0 ? input.durationMs : 1000)
		: 1;
	let x = input.offsetMode === 'end' && Number.isFinite(endTime)
		? (time - endTime) / scale + last.x
		: time / scale;
	const duration = last.x - first.x;
	let value: number[];
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
		} else if (next == null || previous.x === x || previous.interpolation.type === 'hold') {
			value = previous.value;
		} else {
			const progress = (x - previous.x) / (next.x - previous.x);
			value = previous.value.map((component, i) => component + (next.value[i] - component) * progress);
		}
	}
	// scalarは通常の数値として返す。色は未乗算のままShaderInputへの変換境界へ渡す。
	return timeline.dataType.kind === 'scalar' ? value[0] : [...value];
}
