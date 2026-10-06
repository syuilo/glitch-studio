import { genId } from '@gs/shared/utility/id.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genEmptyValue } from '@gs/shared/parameter/parameter-default.ts';
import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import { isKeyframesDataType, isKeyframeValue, supportsKeyframeInterpolation } from '@gs/shared/keyframes/keyframes-timeline.ts';
import { evaluateKeyframesTimeline } from '@gs/shared/keyframes/keyframes-timeline-evaluator.ts';
import { validateEnumParameterValue } from '@gs/shared/parameter/parameter-definition.ts';
import type { KeyframesDataType, KeyframesTimelineData, KeyframesTimelineKeyframe, KeyframeInterpolation } from '@gs/shared/keyframes/keyframes-timeline.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import { isLiteralParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterBindingBase } from '@gs/shared/parameter/parameter-binding.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';

type InlineKeyframesTimeline = Extract<ValueParameterBinding, { inputSource: 'keyframesTimelineInline' }>;

export function canEditKeyframesTimeline(definition: ParameterDefinition, input: InlineKeyframesTimeline): definition is ParameterDefinition<KeyframesDataType> {
	if (!isKeyframesDataType(definition.dataType)) return false;
	// enumの選択肢が更新されても、古いキーを表示し、最新の選択肢で修正できるようにする。
	return (definition.dataType.kind === 'enum' && input.keyframesTimeline.dataType.kind === 'enum')
		|| areDataTypesEqual(definition.dataType, input.keyframesTimeline.dataType);
}

type KeyframeDraft = { id: string; x: number; value: unknown; interpolation: KeyframeInterpolation };

function createTimelineData(dataType: KeyframesDataType, keyframes: KeyframeDraft[], isNormalized: boolean): KeyframesTimelineData {
	if (!keyframes.every(point => isKeyframeValue(dataType, point.value)
		&& (supportsKeyframeInterpolation(dataType) || point.interpolation.type === 'hold'))) throw new Error('Invalid keyframe value or interpolation');
	// 実行時に型と全キーの対応を確認済み。独立した引数の相関をunionへ戻す。
	return deepClone({ dataType, keyframes, isNormalized }) as KeyframesTimelineData;
}

export function createInlineKeyframesTimeline(definition: ParameterDefinition, current?: ParameterBindingBase): InlineKeyframesTimeline {
	if (!isKeyframesDataType(definition.dataType)) throw new Error('Parameter does not support keyframes');
	const value = current != null && isLiteralParameterBinding(current) ? current.value : definition.defaultValue.value;
	return {
		inputSource: 'keyframesTimelineInline',
		keyframesTimeline: createTimelineData(definition.dataType, [{
			id: genId(), x: 0, value, interpolation: { type: supportsKeyframeInterpolation(definition.dataType) ? 'linear' : 'hold' },
		}], false),
		trimmedDurationMs: null,
		wrapMode: 'clamp',
		offsetMode: 'start',
	};
}

export function updateInlineKeyframe(input: InlineKeyframesTimeline, definition: ParameterDefinition, keyframeId: string,
	patch: { x?: number; value?: unknown; interpolation?: KeyframeInterpolation }): InlineKeyframesTimeline | null {
	if (!canEditKeyframesTimeline(definition, input)) return null;
	if (patch.x !== undefined && (!Number.isFinite(patch.x) || patch.x < 0)) return null;
	if (Object.hasOwn(patch, 'value')) {
		if (!isKeyframeValue(definition.dataType, patch.value)) return null;
		validateEnumParameterValue(definition, patch.value);
	}
	if (patch.interpolation != null && !supportsKeyframeInterpolation(definition.dataType) && patch.interpolation.type !== 'hold') return null;
	const keyframe = input.keyframesTimeline.keyframes.find(point => point.id === keyframeId);
	if (keyframe == null || Object.entries(patch).every(([key, value]) => JSON.stringify(keyframe[key as keyof KeyframesTimelineKeyframe]) === JSON.stringify(value))) return null;
	const keyframes = input.keyframesTimeline.keyframes.map(point => point.id === keyframeId ? { ...point, ...patch } : point);
	return {
		...deepClone(input),
		keyframesTimeline: createTimelineData(definition.dataType, keyframes, input.keyframesTimeline.isNormalized),
	};
}

export function insertInlineKeyframe(input: InlineKeyframesTimeline, definition: ParameterDefinition, x: number, endTime: number): { value: InlineKeyframesTimeline; keyframeId: string } | null {
	if (!canEditKeyframesTimeline(definition, input) || !Number.isFinite(x) || x < 0) return null;
	const keyframes: KeyframeDraft[] = input.keyframesTimeline.keyframes.toSorted((a, b) => a.x - b.x);
	const previous = keyframes.findLast(point => point.x <= x);
	if (previous?.x === x) return { value: input, keyframeId: previous.id };
	const fallback = definition.dataType.kind === 'enum' ? definition.defaultValue.value : genEmptyValue(definition);
	// 挿入は既存区間の分割なので、区間外では繰り返しを適用しない。
	const evaluated = evaluateKeyframesTimeline(input.keyframesTimeline, { ...input, wrapMode: 'clamp' }, x, endTime, fallback);
	const keyframeId = genId();
	const interpolation = previous?.interpolation ?? { type: supportsKeyframeInterpolation(definition.dataType) ? 'linear' : 'hold' };
	keyframes.push({ id: keyframeId, x, value: evaluated, interpolation });
	keyframes.sort((a, b) => a.x - b.x);
	return { value: {
		...deepClone(input),
		keyframesTimeline: createTimelineData(definition.dataType, keyframes, input.keyframesTimeline.isNormalized),
	}, keyframeId };
}

/** コピーした値・補間を保持して追加する。同時刻の既存キーを上書きせず、全件を拒否する。 */
export function appendInlineKeyframes(input: InlineKeyframesTimeline, definition: ParameterDefinition, added: readonly KeyframesTimelineKeyframe[]): InlineKeyframesTimeline | null {
	if (!canEditKeyframesTimeline(definition, input) || added.length === 0) return null;
	const ids = new Set(input.keyframesTimeline.keyframes.map(point => point.id));
	const times = new Set(input.keyframesTimeline.keyframes.map(point => point.x));
	for (const point of added) {
		if (!Number.isFinite(point.x) || point.x < 0 || ids.has(point.id) || times.has(point.x)
			|| !isKeyframeValue(definition.dataType, point.value)
			|| (!supportsKeyframeInterpolation(definition.dataType) && point.interpolation.type !== 'hold')) return null;
		try { validateEnumParameterValue(definition, point.value); } catch { return null; }
		ids.add(point.id);
		times.add(point.x);
	}
	return { ...deepClone(input), keyframesTimeline: createTimelineData(definition.dataType,
		[...input.keyframesTimeline.keyframes, ...added].toSorted((a, b) => a.x - b.x), input.keyframesTimeline.isNormalized) };
}
