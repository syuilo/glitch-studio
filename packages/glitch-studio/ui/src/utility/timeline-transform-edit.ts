import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { insertInlineKeyframe, updateInlineKeyframe, canEditKeyframesTimeline } from './keyframes-timeline.ts';
import type { TimelineParameterBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { TimelineLayerTransform } from '@gs/subsystems_timeline_shared/layer-transform.ts';

export type TimelineTransformKey = 'position' | 'scale' | 'rotation';
export type TimelineTransformBindings = Partial<Record<TimelineTransformKey, TimelineParameterBinding>>;

export function canEditTimelineTransform(binding: TimelineParameterBinding | undefined, key: TimelineTransformKey): boolean {
	return binding == null || binding.inputSource === 'literal'
		|| (binding.inputSource === 'keyframesTimelineInline' && canEditKeyframesTimeline(timelineCompositingParamDefs[key], binding));
}

/** 一回の操作で編集するBindingを先に固定する。追加キーのIDをドラッグ中・Redoで維持する。 */
export function prepareTimelineTransformBindings(bindings: TimelineTransformBindings, keys: TimelineTransformKey[], time: number): TimelineTransformBindings {
	const result: TimelineTransformBindings = {};
	for (const key of keys) {
		const binding = bindings[key] ?? timelineCompositingParamDefs[key].defaultValue;
		if (!canEditTimelineTransform(binding, key)) throw new Error('Transform parameter is driven by an expression or automation');
		result[key] = binding.inputSource === 'keyframesTimelineInline'
			? insertInlineKeyframe(binding, timelineCompositingParamDefs[key], Math.round(time), 0)!.value : deepClone(binding);
	}
	return result;
}

export function updateTimelineTransformBindings(prepared: TimelineTransformBindings, transform: TimelineLayerTransform, time: number): TimelineTransformBindings {
	const result: TimelineTransformBindings = {};
	for (const key of Object.keys(prepared) as TimelineTransformKey[]) {
		const binding = prepared[key]!;
		if (binding.inputSource === 'keyframesTimelineInline') {
			const keyframe = binding.keyframesTimeline.keyframes.find(point => point.x === Math.round(time))!;
			result[key] = updateInlineKeyframe(binding, timelineCompositingParamDefs[key], keyframe.id, { value: transform[key] }) ?? deepClone(binding);
		} else result[key] = { inputSource: 'literal', value: deepClone(transform[key]) };
	}
	return result;
}
