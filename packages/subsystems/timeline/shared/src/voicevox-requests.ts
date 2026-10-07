import { getVoicevoxRequest, getVoicevoxRequestKey } from './layers/voicevox/voicevox.ts';
import { getSceneAudioPlacements } from './scene-audio.ts';
import { getSceneDuration, getTimelineScene } from './scenes.ts';
import { getTimelineClipEnd } from './timing.ts';
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

/** 描画する各Sceneの音声履歴も含め、指定区間に必要な生成要求を列挙する。 */
export function getRequiredVoicevoxRequestsForRendering(scenes: readonly TimelineScene[], sceneId: string, startMs: number, endMs: number): VoicevoxRequest[] {
	const requests = new Map<string, VoicevoxRequest>();
	const visit = (id: string, start: number, end: number) => {
		const scene = getTimelineScene(scenes, id);
		start = Math.max(0, start);
		end = Math.min(end, getSceneDuration(scene));
		if (end <= start) return;
		// 音声窓は所属Sceneの時刻で過去を読む。親のトリム前に終了した発話も必要に
		// なり得るため、各Sceneで時刻0から集める。窓の長さはエフェクト側が所有する。
		for (const request of getRequiredVoicevoxRequests(scenes, id, 0, end)) {
			requests.set(getVoicevoxRequestKey(request), request);
		}
		for (const layer of scene.layers) {
			if (layer.isDisabled || layer.layerType !== 'scene') continue;
			for (const clip of layer.clips) {
				const visibleStart = Math.max(start, clip.startMs);
				const visibleEnd = Math.min(end, getTimelineClipEnd(clip));
				if (visibleEnd <= visibleStart) continue;
				// 描画区間だけを子の内容時刻へ変換する。履歴の開始を親のクリップで制限しない。
				visit(clip.sceneId, clip.contentOffsetMs + visibleStart - clip.startMs, clip.contentOffsetMs + visibleEnd - clip.startMs);
			}
		}
	};
	visit(sceneId, startMs, endMs);
	return [...requests.values()];
}
