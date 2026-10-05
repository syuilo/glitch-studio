import { validateLiteralAudioSourceBinding } from '@gs/shared/parameter/audio-source.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { VisualModuleParameterBinding, VisualModuleParamDef } from './types.ts';

/** 音声だけはCPU式・画像接続へ流さず、同じ型の公開パラメータを静的に参照する。 */
export function validateVisualModuleAudioBinding(def: ParameterDefinition, binding: VisualModuleParameterBinding, paramDefs: readonly VisualModuleParamDef[]): void {
	if (binding.inputSource === 'externalCustomParameterInput') {
		const source = paramDefs.find(source => source.id === binding.parameterId);
		if (def.dataType.kind === 'audioSource') {
			if (binding.parameterId && (!source || source.canNode || source.dataType.kind !== 'audioSource')) throw new Error('Invalid custom audio parameter');
		} else if (source?.dataType.kind === 'audioSource') throw new Error('Audio sources require an audio parameter');
	} else if (def.dataType.kind === 'audioSource') validateLiteralAudioSourceBinding(binding);
}
