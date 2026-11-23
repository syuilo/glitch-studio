import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import { areNodeDataTypesCompatible, getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

/** プレビューの配置だけが解釈する。Effectの定義や公開パラメータの既定値には保存しない。 */
export type EffectLivePreviewMediaBinding =
	| { inputSource: 'previewInputImage' }
	| { inputSource: 'previewInputAudio' };

export type EffectLivePreviewParameterBinding = ValueParameterBinding | EffectLivePreviewMediaBinding;

export function isEffectLivePreviewMediaBinding(binding: { inputSource: string }): binding is EffectLivePreviewMediaBinding {
	return binding.inputSource === 'previewInputImage' || binding.inputSource === 'previewInputAudio';
}

export function canUseEffectLivePreviewInput(definition: ParameterDefinition, inputSource: EffectLivePreviewMediaBinding['inputSource']): boolean {
	if (inputSource === 'previewInputAudio') return definition.dataType.kind === 'audioSource';
	return areNodeDataTypesCompatible({ kind: 'color' }, getNodeInputDataType(definition));
}
