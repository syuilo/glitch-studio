import { inspectLiteralAudioSourceBinding } from '@gs/shared/parameter/audio-source.ts';
import type { ValidationDiagnostic } from '@gs/shared/validation/diagnostic.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { VisualModuleParameterBinding, VisualModuleParamDef } from './types.ts';

/** 音声だけはCPU式・画像接続へ流さず、同じ型の公開パラメータを静的に参照する。 */
export function validateVisualModuleAudioBinding(def: ParameterDefinition, binding: VisualModuleParameterBinding, paramDefs: readonly VisualModuleParamDef[]): void {
	const diagnostics = inspectVisualModuleAudioBinding(def, binding, paramDefs);
	if (diagnostics.length) throw new Error(diagnostics[0].message);
}

export function inspectVisualModuleAudioBinding(def: ParameterDefinition, binding: VisualModuleParameterBinding, paramDefs: readonly VisualModuleParamDef[]): ValidationDiagnostic[] {
	if (binding.inputSource === 'externalCustomParameterInput') {
		const source = paramDefs.find(source => source.id === binding.parameterId);
		if (def.dataType.kind === 'audioSource') {
			if (binding.parameterId && (!source || source.canNode || source.dataType.kind !== 'audioSource')) return [{ code: 'audio.parameter', message: 'Invalid custom audio parameter' }];
		} else if (source?.dataType.kind === 'audioSource') return [{ code: 'audio.parameter', message: 'Audio sources require an audio parameter' }];
	} else if (def.dataType.kind === 'audioSource') return inspectLiteralAudioSourceBinding(binding);
	return [];
}
