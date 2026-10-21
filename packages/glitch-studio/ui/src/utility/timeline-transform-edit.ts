import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { preserveParameterExpressionModifier } from '@gs/shared/parameter/parameter-expression-modifier.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { insertInlineKeyframe, updateInlineKeyframe, canEditKeyframesTimeline } from './keyframes-timeline.ts';
import type { TimelineParameterBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { TimelineLayerTransform } from '@gs/subsystems_timeline_shared/layer-transform.ts';

export type TimelineTransformKey = 'position' | 'scale' | 'rotation';
export type TimelineTransformBindings = Partial<Record<TimelineTransformKey, TimelineParameterBinding>>;

// 省略可能プロパティや検索結果を直接受け取る境界なので、入力のundefinedも未指定として受け入れる。
export function canEditTimelineTransform(binding: TimelineParameterBinding | null | undefined, key: TimelineTransformKey): boolean {
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

export function updateTimelineTransformBindings(prepared: TimelineTransformBindings, transform: TimelineLayerTransform, time: number, displayedStart?: TimelineLayerTransform): TimelineTransformBindings {
	const result: TimelineTransformBindings = {};
	for (const key of Object.keys(prepared) as TimelineTransformKey[]) {
		const binding = prepared[key]!;
		let value = transform[key];
		if (displayedStart != null && binding.expressionModifier?.enabled === true) {
			// 任意の加工式を逆算せず、表示上の操作量だけを基準値へ反映する。
			// 加工後の絶対値をキーへ保存すると、同じ加工が次の描画で二重に適用されてしまう。
			const base = binding.inputSource === 'keyframesTimelineInline'
				? binding.keyframesTimeline.keyframes.find(point => point.x === Math.round(time))!.value
				: binding.inputSource === 'literal' ? binding.value : null;
			if (key === 'rotation') value = (base as number) + transform.rotation - displayedStart.rotation;
			else value = (base as [number, number]).map((component, index) => key === 'position'
				? component + transform.position[index] - displayedStart.position[index]
				: displayedStart.scale[index] === 0 ? component : component * transform.scale[index] / displayedStart.scale[index]) as [number, number];
		}
		if (binding.inputSource === 'keyframesTimelineInline') {
			const keyframe = binding.keyframesTimeline.keyframes.find(point => point.x === Math.round(time))!;
			result[key] = updateInlineKeyframe(binding, timelineCompositingParamDefs[key], keyframe.id, { value }) ?? deepClone(binding);
		} else result[key] = preserveParameterExpressionModifier(binding, { inputSource: 'literal', value: deepClone(value) });
	}
	return result;
}
