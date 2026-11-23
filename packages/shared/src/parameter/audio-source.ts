import type { ParameterBindingBase } from './parameter-binding.ts';

/** 未接続の音声入力はnullで保存する。接続はプレビューやTimelineなどの配置側が所有する。 */
export function validateLiteralAudioSourceBinding(binding: ParameterBindingBase): asserts binding is ParameterBindingBase & { inputSource: 'literal'; value: null } {
	if (binding.inputSource !== 'literal' || !('value' in binding)) throw new Error('Audio sources must use a static input');
	if (binding.value !== null) throw new Error('Unconnected audio inputs must be null');
}
