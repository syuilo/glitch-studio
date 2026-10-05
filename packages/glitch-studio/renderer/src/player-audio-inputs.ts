import { getAudioWindowFrameCount } from '@gs/subsystems_audio_shared/audio-input.ts';
import { validatePlayerAudioSourceSelection } from '@gs/glitch-studio_shared/player-audio-source.ts';
import { playerAudioSourceId } from '@gs/shared/audio.ts';
import type { AudioInput } from '@gs/subsystems_audio_shared/audio-input.ts';
import type { AudioHistory, AudioHistorySnapshot } from '@gs/subsystems_audio_renderer/audio-history.ts';
import type { AudioSourceId } from '@gs/shared/audio.ts';

/** Playerの履歴を解決し、同じ履歴状態のスナップショットをノード・描画間で共有する。 */
export class PlayerAudioInputs {
	// 取得元の切断・差し替えで、使われなくなった履歴とPCMを保持し続けない。
	private snapshots = new WeakMap<AudioHistory, { key: string; sourceRevision: string; input: AudioInput }>();
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
		const cacheKey = JSON.stringify(['player', selection.playerId, ++this.snapshotVersion]);
		const sourceRevision = JSON.stringify([selection.playerId, history.generation, history.revision, history.sampleRate, history.channelCount]);
		// endFrameだけが進んだ場合は同じ音声の続きとしてFFTを進められる。
		// 履歴の差し替え・シークは、カウンターが偶然一致しても別の取得元にする。
		const sourceKey = cached?.sourceRevision === sourceRevision ? cached.input.sourceKey : cacheKey;
		const input = createPlayerAudioInput(history.snapshot(), cacheKey, sourceKey);
		this.snapshots.set(history, { key, sourceRevision, input });
		return input;
	}
}

/** 履歴本体を閉じ込めず、固定済みブロックと区間だけを保持する。PCMの再複製は行わない。 */
function createPlayerAudioInput(snapshot: AudioHistorySnapshot, cacheKey: string, sourceKey: string): AudioInput {
	const { startFrame, endFrame, sampleRate } = snapshot;
	return {
		cacheKey,
		sourceKey,
		sampleRate,
		startFrame,
		endFrame,
		readWindow(durationSeconds, signal) {
			signal.throwIfAborted();
			return snapshot.readWindow(getAudioWindowFrameCount(durationSeconds, sampleRate));
		},
	};
}
