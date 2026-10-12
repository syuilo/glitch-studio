import type { ParameterBindingBase } from './parameter-binding.ts';

/** 音声の取得元は静的に指定する。valueの形式と解決は利用ドメインが所有する。 */
export function validateLiteralAudioSourceBinding(binding: ParameterBindingBase): asserts binding is ParameterBindingBase & { inputSource: 'literal'; value: unknown } {
	const diagnostics = inspectLiteralAudioSourceBinding(binding);
	if (diagnostics.length) throw new Error(diagnostics[0].message);
}

export function inspectLiteralAudioSourceBinding(binding: ParameterBindingBase): import('../validation/diagnostic.ts').ValidationDiagnostic[] {
	return binding.inputSource === 'literal' && 'value' in binding ? [] : [{ code: 'audio.binding', message: 'Audio sources must use a static input' }];
}
