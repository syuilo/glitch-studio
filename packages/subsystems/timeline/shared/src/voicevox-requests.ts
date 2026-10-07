import { getVoicevoxRequest, getVoicevoxRequestKey } from './layers/voicevox/voicevox.ts';
import { getSceneAudioPlacements } from './scene-audio.ts';
import type { VoicevoxRequest } from './layers/voicevox/voicevox.ts';
import type { TimelineScene } from './types.ts';

/** 無効・クリップ外の発話も編集状態の一部なので、生成と保存の参照として保持する。 */
export function getVoicevoxRequests(scenes: readonly TimelineScene[]): VoicevoxRequest[] {
	return scenes.flatMap(scene => scene.layers.flatMap(layer => layer.layerType === 'voicevox'
		? layer.utterances.filter(utterance => utterance.text !== '').map(utterance => getVoicevoxRequest(layer.voicevox, utterance)) : []));
}

/** 指定区間で有効な配置だけを列挙する。音声の長さが未確定でも同じ配置規則を使う。 */
export function getRequiredVoicevoxRequests(scenes: readonly TimelineScene[], sceneId: string, startMs: number, endMs: number): VoicevoxRequest[] {
	const requests = new Map<string, VoicevoxRequest>();
	for (const placement of getSceneAudioPlacements(scenes, sceneId)) {
		if (placement.type === 'speech' && placement.startMs < endMs && placement.endMs > startMs) {
			requests.set(getVoicevoxRequestKey(placement.request), placement.request);
		}
	}
	return [...requests.values()];
}
