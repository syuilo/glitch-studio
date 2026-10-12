import { type ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import { inspectParameterTree } from '@gs/shared/parameter/static-parameter-validation.ts';
import { inspectTimelineBinding, inspectTimelineBindingSource } from './parameter-validation.ts';
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

/** レイヤーに終端や接続スコープはない。UI以外から渡されたBindingも保存時に拒否する。 */
export function validateTimelineParameterBinding(binding: ParameterBindingBase, allowLayerInput?: false): asserts binding is TimelineParameterBinding;
export function validateTimelineParameterBinding(binding: ParameterBindingBase, allowLayerInput: boolean, allowAudioInput?: boolean): asserts binding is TimelineEffectParameterBinding;
export function validateTimelineParameterBinding(binding: ParameterBindingBase, allowLayerInput = false, allowAudioInput = allowLayerInput): asserts binding is TimelineEffectParameterBinding {
	const diagnostics = inspectTimelineBindingSource(binding, allowLayerInput, allowAudioInput);
	if (diagnostics.length) throw new Error(diagnostics[0].message);
}

/** 保存と評価で同じ制約を使い、配列内への不正なBindingの混入も防ぐ。互換性の強制はUI設定に従う。 */
export function validateTimelineParameterTree(def: ParameterDefinition, binding: ParameterBindingBase, allowLayerInput?: false): asserts binding is TimelineParameterBinding;
export function validateTimelineParameterTree(def: ParameterDefinition, binding: ParameterBindingBase, allowLayerInput: boolean, allowAudioInput?: boolean): asserts binding is TimelineEffectParameterBinding;
export function validateTimelineParameterTree(def: ParameterDefinition, binding: ParameterBindingBase, allowLayerInput = false, allowAudioInput = allowLayerInput): asserts binding is TimelineEffectParameterBinding {
	const diagnostics = inspectParameterTree(def, binding, (leaf, value, path) => inspectTimelineBinding(leaf, value, path, allowLayerInput, allowAudioInput));
	if (diagnostics.length) throw new Error(diagnostics[0].message);
}
