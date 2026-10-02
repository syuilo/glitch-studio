import type { ParameterBinding } from '../types.ts';

/** レイヤーに終端や接続スコープはない。UI以外から渡されたBindingも保存時に拒否する。 */
export function validateTimelineParameterBinding(binding: ParameterBinding): void {
	if (binding.inputSource === 'node' || binding.inputSource === 'externalCustomParameterInput') throw new Error('Unsupported layer parameter input source');
	if ((binding.inputSource === 'automationGraphInline' || binding.inputSource === 'automationGraphReference') && binding.offsetMode !== 'start') {
		throw new Error('Layer automation graphs must use the scene start');
	}
	if (binding.inputSource === 'keyframesTimelineInline' && (binding.keyframesTimeline.isNormalized || binding.offsetMode !== 'start' || binding.wrapMode !== 'clamp' || binding.trimmedDurationMs != null)) {
		throw new Error('Timeline keyframes must use absolute scene time without wrapping');
	}
}
