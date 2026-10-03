import { type ParameterDefinition, getArrayElementDefinition, getStructFieldDefinitions } from '@gs/shared/parameter/parameter-definition.ts';
import { isValueParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterArrayElement, ParameterBindingBase } from '@gs/shared/parameter/parameter-binding.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { FitMode, WrapMode } from '@gs/shared/types.ts';

export type TimelineLayerInputBinding = {
	inputSource: 'layerInput';
	fitMode: FitMode;
	wrapMode: WrapMode;
	filterMode: 'linear' | 'nearest';
};

export type TimelineParameterBinding = ValueParameterBinding;
export type TimelineEffectParameterBinding = TimelineParameterBinding | TimelineLayerInputBinding;

function isTimelineLayerInputBinding(binding: ParameterBindingBase): binding is TimelineLayerInputBinding {
	return binding.inputSource === 'layerInput';
}

/** レイヤーに終端や接続スコープはない。UI以外から渡されたBindingも保存時に拒否する。 */
export function validateTimelineParameterBinding(binding: ParameterBindingBase, allowLayerInput?: false): asserts binding is TimelineParameterBinding;
export function validateTimelineParameterBinding(binding: ParameterBindingBase, allowLayerInput: boolean): asserts binding is TimelineEffectParameterBinding;
export function validateTimelineParameterBinding(binding: ParameterBindingBase, allowLayerInput = false): asserts binding is TimelineEffectParameterBinding {
	if (isTimelineLayerInputBinding(binding)) {
		if (!allowLayerInput) throw new Error('Layer input is only available in effect layer parameters');
		if (!['cover', 'contain', 'stretch'].includes(binding.fitMode)
			|| !['clamp', 'repeat', 'repeatMirrored', 'transparent'].includes(binding.wrapMode)
			|| !['linear', 'nearest'].includes(binding.filterMode)) throw new Error('Invalid layer input sampling');
		return;
	}
	// 他ドメインの方式を列挙せず、このスコープが扱える共通の入力方式だけを受け入れる。
	if (!isValueParameterBinding(binding)) throw new Error('Unsupported layer parameter input source');
	if ((binding.inputSource === 'automationGraphInline' || binding.inputSource === 'automationGraphReference') && binding.offsetMode !== 'start') {
		throw new Error('Layer automation graphs must use the scene start');
	}
	if (binding.inputSource === 'keyframesTimelineInline' && (binding.keyframesTimeline.isNormalized || binding.offsetMode !== 'start' || binding.wrapMode !== 'clamp' || binding.trimmedDurationMs != null)) {
		throw new Error('Timeline keyframes must use absolute scene time without wrapping');
	}
	if (binding.inputSource === 'keyframesTimelineInline' && binding.keyframesTimeline.keyframes.some(point => !Number.isSafeInteger(point.x) || point.x < 0)) {
		throw new Error('Timeline keyframes must use non-negative integer milliseconds');
	}
}

/** 保存と評価で同じ制約を使い、配列内への不正なBindingの混入も防ぐ。互換性の強制はUI設定に従う。 */
export function validateTimelineParameterTree(def: ParameterDefinition, binding: ParameterBindingBase, allowLayerInput?: false): asserts binding is TimelineParameterBinding;
export function validateTimelineParameterTree(def: ParameterDefinition, binding: ParameterBindingBase, allowLayerInput: boolean): asserts binding is TimelineEffectParameterBinding;
export function validateTimelineParameterTree(def: ParameterDefinition, binding: ParameterBindingBase, allowLayerInput = false): asserts binding is TimelineEffectParameterBinding {
	validateTimelineParameterBinding(binding, allowLayerInput && def.canNode === true);
	if (def.dataType.kind !== 'array' && def.dataType.kind !== 'struct') return;
	if (binding.inputSource !== 'literal') throw new Error('Container parameter must be literal');
	if (def.dataType.kind === 'array') {
		if (!Array.isArray(binding.value)) throw new Error('Expected array parameter');
		const elements = binding.value as ParameterArrayElement<ParameterBindingBase>[];
		if (new Set(elements.map(element => element.id)).size !== elements.length) throw new Error('Duplicate array element ID');
		for (const element of elements) validateTimelineParameterTree(getArrayElementDefinition(def), element.binding, allowLayerInput);
	} else {
		for (const [key, field] of Object.entries(getStructFieldDefinitions(def))) validateTimelineParameterTree(field, binding.value[key], allowLayerInput);
	}
}
