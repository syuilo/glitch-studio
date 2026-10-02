import { genId } from '@glitch/shared/utility/id.ts';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { genEmptyValue } from '@glitch/shared/parameter/parameter-default.ts';
import { areDataTypesEqual } from '@glitch/shared/data-type/data-type.ts';
import { isKeyframesDataType, isKeyframeValue, supportsKeyframeInterpolation } from '@glitch/shared/keyframes/keyframes-timeline.ts';
import { evaluateKeyframesTimeline } from '@glitch/shared/keyframes/keyframes-timeline-evaluator.ts';
import { validateEnumParameterValue } from '@glitch/shared/parameter/parameter-definition.ts';
import type { KeyframesDataType, KeyframesTimelineData, KeyframesTimelineKeyframe, KeyframeInterpolation } from '@glitch/shared/keyframes/keyframes-timeline.ts';
import type { ParameterDefinition } from '@glitch/shared/parameter/parameter-definition.ts';
import type { ParameterBinding } from '@glitch/shared/parameter/parameter-binding.ts';

type InlineKeyframesTimeline = Extract<ParameterBinding, { inputSource: 'keyframesTimelineInline' }>;

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

export function createInlineKeyframesTimeline(definition: ParameterDefinition, current?: ParameterBinding): InlineKeyframesTimeline {
	if (!isKeyframesDataType(definition.dataType)) throw new Error('Parameter does not support keyframes');
	const value = current?.inputSource === 'literal' ? current.value : definition.defaultValue.value;
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
