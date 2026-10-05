import type { AudioInput } from '@gs/subsystems_audio_shared/audio-input.ts';
import type { TimelineAudioInputBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';

export type TimelineAudioInputProvider = (binding: TimelineAudioInputBinding, sceneTimeMs: number, isExport: boolean) => AudioInput | null;

/** 同じフレームの同じ入力は共有し、異なるレイヤーの入力や並行する評価は混同しない。 */
export function createTimelineAudioInputResolver(provider: TimelineAudioInputProvider | undefined, sceneTimeMs: number, isExport: boolean) {
	const inputs = new Map<string, AudioInput | null>();
	return (binding: TimelineAudioInputBinding): AudioInput | null => {
		if (binding.inputSource === 'layerAudio' && binding.layerId === null) return null;
		const key = JSON.stringify([binding.inputSource, binding.inputSource === 'layerAudio' ? binding.layerId : null]);
		if (!inputs.has(key)) {
			if (!provider) throw new Error('Timeline audio input is unavailable');
			inputs.set(key, provider(binding, sceneTimeMs, isExport));
		}
		return inputs.get(key)!;
	};
}
