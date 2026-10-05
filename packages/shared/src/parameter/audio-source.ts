import type { ParameterBindingBase } from './parameter-binding.ts';

// 保存するのは取得元の指定だけ。PCMや読み出し関数はレンダラー内で解決する。
export type AudioSourceSelection = { type: 'player'; playerId: string } | null;

export function validateAudioSourceSelection(value: unknown): asserts value is AudioSourceSelection {
	if (value === null) return;
	if (typeof value !== 'object' || !('type' in value) || value.type !== 'player'
		|| !('playerId' in value) || typeof value.playerId !== 'string' || !value.playerId) {
		throw new Error('Invalid audio source');
	}
}

/** 音声の取得元は静的に指定する。共通の式評価へ実行時リソースを渡さない。 */
export function validateLiteralAudioSourceBinding(binding: ParameterBindingBase): asserts binding is ParameterBindingBase & { inputSource: 'literal'; value: AudioSourceSelection } {
	if (binding.inputSource !== 'literal' || !('value' in binding)) throw new Error('Audio sources must use a static input');
	validateAudioSourceSelection(binding.value);
}
