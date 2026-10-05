import { getAudioWindowFrameCount } from '@gs/subsystems_audio_shared/audio-input.ts';
import type { AudioInput } from '@gs/subsystems_audio_shared/audio-input.ts';
import type { AudioHistory } from '@gs/shared/audio-history.ts';

/** prepare中のPlayer更新で同じ描画の入力が変わらないよう、保持中のPCMを一度だけ固定する。 */
export function createPlayerAudioInput(playerId: string, history: AudioHistory): AudioInput {
	const { startFrame, endFrame, sampleRate, generation, revision } = history;
	const channels = [new Float32Array(endFrame - startFrame), new Float32Array(endFrame - startFrame)] as const;
	for (let frame = startFrame; frame < endFrame; frame++) {
		channels[0][frame - startFrame] = history.sample(frame, 'left');
		channels[1][frame - startFrame] = history.sample(frame, history.channelCount === 1 ? 'left' : 'right');
	}
	return {
		cacheKey: JSON.stringify([playerId, generation, revision, endFrame]),
		readWindow(durationSeconds, signal) {
			signal.throwIfAborted();
			const frames = getAudioWindowFrameCount(durationSeconds, sampleRate);
			const output = [new Float32Array(frames), new Float32Array(frames)] as const;
			const count = Math.min(frames, endFrame - startFrame);
			for (let channel = 0; channel < 2; channel++) output[channel].set(channels[channel].subarray(channels[channel].length - count), frames - count);
			return { sampleRate, channels: output };
		},
	};
}
