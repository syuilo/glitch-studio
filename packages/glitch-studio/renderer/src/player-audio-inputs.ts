import { getAudioWindowFrameCount } from '@gs/subsystems_audio_shared/audio-input.ts';
import { validatePlayerAudioSourceSelection } from '@gs/glitch-studio_shared/player-audio-source.ts';
import { playerAudioSourceId } from '@gs/shared/audio.ts';
import type { AudioInput } from '@gs/subsystems_audio_shared/audio-input.ts';
import type { AudioHistory } from '@gs/shared/audio-history.ts';
import type { AudioSourceId } from '@gs/shared/audio.ts';

/** Playerの履歴を解決し、同じ履歴状態のスナップショットをノード・描画間で共有する。 */
export class PlayerAudioInputs {
	// 取得元の切断・差し替えで、使われなくなった履歴とPCMを保持し続けない。
	private snapshots = new WeakMap<AudioHistory, { key: string; input: AudioInput }>();
	private snapshotVersion = 0;

	constructor(private sources: ReadonlyMap<AudioSourceId, AudioHistory>) {}

	resolve(selection: unknown): AudioInput | null {
		validatePlayerAudioSourceSelection(selection);
		if (selection === null) return null;
		const history = this.sources.get(playerAudioSourceId(selection.playerId));
		if (!history) return null;
		// 通常の追記ではrevisionが増えないためendFrameも含める。別の履歴オブジェクトは
		// 同じカウンター値でも別の入力であり、cacheKeyにも固有の版を割り当てる。
		const key = JSON.stringify([selection.playerId, history.generation, history.revision,
			history.startFrame, history.endFrame, history.sampleRate, history.channelCount]);
		const cached = this.snapshots.get(history);
		if (cached?.key === key) return cached.input;
		const input = createPlayerAudioInput(history, JSON.stringify(['player', selection.playerId, ++this.snapshotVersion]));
		this.snapshots.set(history, { key, input });
		return input;
	}
}

/** prepare中のPlayer更新で同じ描画の入力が変わらないよう、保持中のPCMを一度だけ固定する。 */
function createPlayerAudioInput(history: AudioHistory, cacheKey: string): AudioInput {
	const { startFrame, endFrame, sampleRate } = history;
	const channels = [new Float32Array(endFrame - startFrame), new Float32Array(endFrame - startFrame)] as const;
	for (let frame = startFrame; frame < endFrame; frame++) {
		channels[0][frame - startFrame] = history.sample(frame, 'left');
		channels[1][frame - startFrame] = history.sample(frame, history.channelCount === 1 ? 'left' : 'right');
	}
	return {
		cacheKey,
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
