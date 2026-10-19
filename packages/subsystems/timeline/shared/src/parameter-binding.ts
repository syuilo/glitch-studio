import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import { isValueParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import { inspectStaticParameter } from '@gs/shared/parameter/static-parameter.ts';
import { validateLiteralAudioSourceBinding } from '@gs/shared/parameter/audio-source.ts';
import type { ParameterBindingBase } from '@gs/shared/parameter/parameter-binding.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { FitMode, WrapMode } from '@gs/shared/types.ts';

export type TimelineLayerInputBinding = {
	inputSource: 'layerInput';
	fitMode: FitMode;
	wrapMode: WrapMode;
	filterMode: 'linear' | 'nearest';
};
export type TimelineVisualModuleLayerInputBinding = { inputSource: 'layerInput' };

export type TimelineLayerOutputStage = 'source' | 'rendered' | 'composited';
/** 画像の取得元だけを表す。Visual Module公開入力のサンプリングは内部接続が所有する。 */
export type TimelineAnotherLayerOutputBinding = {
	inputSource: 'anotherLayerOutput';
	layerId: string | null;
	outputStage: TimelineLayerOutputStage;
};
export type TimelineEffectAnotherLayerOutputBinding = TimelineAnotherLayerOutputBinding & Omit<TimelineLayerInputBinding, 'inputSource'>;

export function createLayerInputBinding(): TimelineLayerInputBinding {
	return { inputSource: 'layerInput', fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' };
}

export type TimelineParameterBinding = ValueParameterBinding;
export type TimelineLowerLayerAudioBinding = { inputSource: 'lowerLayerAudio' };
export type TimelineAnotherLayerAudioBinding = { inputSource: 'anotherLayerAudio'; layerId: string | null };
export type TimelineAudioInputBinding = TimelineLowerLayerAudioBinding | TimelineAnotherLayerAudioBinding;
export type TimelineVisualModuleParameterBinding = TimelineParameterBinding | TimelineAudioInputBinding | TimelineVisualModuleLayerInputBinding | TimelineAnotherLayerOutputBinding;
export type TimelineEffectParameterBinding = TimelineParameterBinding | TimelineAudioInputBinding | TimelineLayerInputBinding | TimelineEffectAnotherLayerOutputBinding;

export function isTimelineAudioInputBinding(binding: ParameterBindingBase): binding is TimelineAudioInputBinding {
	return binding.inputSource === 'lowerLayerAudio' || binding.inputSource === 'anotherLayerAudio';
}

export function isTimelineImageInputBinding(binding: ParameterBindingBase): binding is TimelineVisualModuleLayerInputBinding | TimelineAnotherLayerOutputBinding {
	return binding.inputSource === 'layerInput' || binding.inputSource === 'anotherLayerOutput';
}

/** レイヤーに終端や接続スコープはない。UI以外から渡されたBindingも保存時に拒否する。 */
export function validateTimelineParameterBinding(binding: ParameterBindingBase, allowLayerInput?: false): asserts binding is TimelineParameterBinding;
export function validateTimelineParameterBinding(binding: ParameterBindingBase, allowLayerInput: boolean, allowAudioInput?: boolean): asserts binding is TimelineVisualModuleParameterBinding | TimelineEffectParameterBinding;
export function validateTimelineParameterBinding(binding: ParameterBindingBase, allowLayerInput = false, allowAudioInput = allowLayerInput): asserts binding is TimelineVisualModuleParameterBinding | TimelineEffectParameterBinding {
	if (isTimelineAudioInputBinding(binding)) {
		if (!allowAudioInput) throw new Error('Layer audio is not available in this parameter');
		// layerIdのnullは明示的な未選択。省略されたundefinedではBindingの必須フィールドを満たさない。
		if (binding.inputSource === 'anotherLayerAudio' && binding.layerId !== null && (typeof binding.layerId !== 'string' || binding.layerId.length === 0)) throw new Error('Invalid audio layer reference');
		return;
	}
	if (isTimelineImageInputBinding(binding)) {
		if (!allowLayerInput) throw new Error('Layer input is only available in image input parameters');
		if (binding.inputSource === 'anotherLayerOutput') {
			if (binding.layerId !== null && (typeof binding.layerId !== 'string' || binding.layerId.length === 0)) throw new Error('Invalid image layer reference');
			if (!['source', 'rendered', 'composited'].includes(binding.outputStage)) throw new Error('Invalid layer output stage');
		}
		// 公開入力にはサンプリング設定を保存しない。Effect側の必須設定はその境界で検証する。
		if (!('fitMode' in binding)) return;
		const sampling = binding as TimelineLayerInputBinding;
		if (!['cover', 'contain', 'stretch'].includes(sampling.fitMode)
			|| !['clamp', 'repeat', 'repeatMirrored', 'transparent'].includes(sampling.wrapMode)
			|| !['linear', 'nearest'].includes(sampling.filterMode)) throw new Error('Invalid layer input sampling');
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

/**
 * コンテナの構造と末端の入力方式を、一度のツリー走査で検証する。
 * 参照の収集も同じ走査へ渡せるようにし、検証後に同じパラメータをたどり直さない。
 * 通常のliteral値の妥当性は、評価結果を扱う側に残す。
 */
export function validateTimelineParameterTree(def: ParameterDefinition, binding: ParameterBindingBase, allowLayerInput?: false): asserts binding is TimelineParameterBinding;
export function validateTimelineParameterTree(def: ParameterDefinition, binding: ParameterBindingBase, allowLayerInput: boolean, allowAudioInput?: boolean,
	onValue?: (definition: ParameterDefinition, binding: ParameterBindingBase) => void): asserts binding is TimelineVisualModuleParameterBinding | TimelineEffectParameterBinding;
export function validateTimelineParameterTree(def: ParameterDefinition, binding: ParameterBindingBase, allowLayerInput = false, allowAudioInput = allowLayerInput,
	onValue?: (definition: ParameterDefinition, binding: ParameterBindingBase) => void): asserts binding is TimelineVisualModuleParameterBinding | TimelineEffectParameterBinding {
	inspectStaticParameter(def, binding, (leaf, value) => {
		validateTimelineParameterBinding(value, allowLayerInput && leaf.canNode === true, allowAudioInput && leaf.dataType.kind === 'audioSource');
		if (leaf.dataType.kind === 'audioSource' && !isTimelineAudioInputBinding(value)) {
			validateLiteralAudioSourceBinding(value);
			// nullリテラルだけが未選択を表す。undefinedを通すと検証後の値の型を保証できない。
			if (value.value !== null) throw new Error('Timeline audio literals must be unselected');
		}
		onValue?.(leaf, value);
	});
}
