import type { ParameterBindingBase } from './parameter-binding.ts';

/** 音声の取得元は静的に指定する。valueの形式と解決は利用ドメインが所有する。 */
export function validateLiteralAudioSourceBinding(binding: ParameterBindingBase): asserts binding is ParameterBindingBase & { inputSource: 'literal'; value: unknown } {
	if (binding.inputSource !== 'literal' || !('value' in binding)) throw new Error('Audio sources must use a static input');
}
