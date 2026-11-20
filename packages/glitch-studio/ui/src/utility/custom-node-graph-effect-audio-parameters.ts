import { validateLiteralAudioSourceBinding } from '@gs/shared/parameter/audio-source.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { CustomNodeGraphEffectParameterBinding, CustomNodeGraphEffectParamDef } from '../types/custom-node-graph-effect-view.ts';

/** 音声だけはCPU式・画像接続へ流さず、同じ型の公開パラメータを静的に参照する。 */
export function validateCustomNodeGraphEffectAudioBinding(def: ParameterDefinition, binding: CustomNodeGraphEffectParameterBinding, paramDefs: readonly CustomNodeGraphEffectParamDef[]): void {
	if (binding.inputSource === 'customNodeGraphEffectPublicParameterReference') {
		const source = paramDefs.find(source => source.id === binding.parameterId);
		if (def.dataType.kind === 'audioSource') {
			if (binding.parameterId && (!source || source.canNode || source.dataType.kind !== 'audioSource')) throw new Error('Invalid public audio parameter');
		} else if (source?.dataType.kind === 'audioSource') throw new Error('Audio sources require an audio parameter');
	} else if (def.dataType.kind === 'audioSource') validateLiteralAudioSourceBinding(binding);
}
