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

export type TimelineParameterBinding = ValueParameterBinding;
export type TimelineLowerLayerAudioBinding = { inputSource: 'lowerLayerAudio' };
export type TimelineLayerAudioBinding = { inputSource: 'layerAudio'; layerId: string | null };
export type TimelineAudioInputBinding = TimelineLowerLayerAudioBinding | TimelineLayerAudioBinding;
export type TimelineVisualModuleParameterBinding = TimelineParameterBinding | TimelineAudioInputBinding;
export type TimelineEffectParameterBinding = TimelineVisualModuleParameterBinding | TimelineLayerInputBinding;

export function isTimelineAudioInputBinding(binding: ParameterBindingBase): binding is TimelineAudioInputBinding {
	return binding.inputSource === 'lowerLayerAudio' || binding.inputSource === 'layerAudio';
}

function isTimelineLayerInputBinding(binding: ParameterBindingBase): binding is TimelineLayerInputBinding {
	return binding.inputSource === 'layerInput';
}

/** レイヤーに終端や接続スコープはない。UI以外から渡されたBindingも保存時に拒否する。 */
export function validateTimelineParameterBinding(binding: ParameterBindingBase, allowLayerInput?: false): asserts binding is TimelineParameterBinding;
export function validateTimelineParameterBinding(binding: ParameterBindingBase, allowLayerInput: boolean, allowAudioInput?: boolean): asserts binding is TimelineEffectParameterBinding;
export function validateTimelineParameterBinding(binding: ParameterBindingBase, allowLayerInput = false, allowAudioInput = allowLayerInput): asserts binding is TimelineEffectParameterBinding {
	if (isTimelineAudioInputBinding(binding)) {
		if (!allowAudioInput) throw new Error('Layer audio is not available in this parameter');
		// layerIdのnullは明示的な未選択。省略されたundefinedではBindingの必須フィールドを満たさない。
		if (binding.inputSource === 'layerAudio' && binding.layerId !== null && (typeof binding.layerId !== 'string' || binding.layerId.length === 0)) throw new Error('Invalid audio layer reference');
		return;
	}
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

/**
 * コンテナの構造と末端の入力方式を、一度のツリー走査で検証する。
 * 参照の収集も同じ走査へ渡せるようにし、検証後に同じパラメータをたどり直さない。
 * 通常のliteral値の妥当性は、評価結果を扱う側に残す。
 */
export function validateTimelineParameterTree(def: ParameterDefinition, binding: ParameterBindingBase, allowLayerInput?: false): asserts binding is TimelineParameterBinding;
export function validateTimelineParameterTree(def: ParameterDefinition, binding: ParameterBindingBase, allowLayerInput: boolean, allowAudioInput?: boolean,
	onValue?: (definition: ParameterDefinition, binding: ParameterBindingBase) => void): asserts binding is TimelineEffectParameterBinding;
export function validateTimelineParameterTree(def: ParameterDefinition, binding: ParameterBindingBase, allowLayerInput = false, allowAudioInput = allowLayerInput,
	onValue?: (definition: ParameterDefinition, binding: ParameterBindingBase) => void): asserts binding is TimelineEffectParameterBinding {
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
