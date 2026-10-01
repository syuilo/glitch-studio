import { getSceneDuration, getTimelineScene, validateTimelineScenes } from './scenes.ts';
import { getTimelineLayerStart, getTimelineLayerEnd } from './timing.ts';
import type { TimelineParameterBinding, TimelineScene } from './types.ts';
import type { AutomationGraph } from '../types.ts';

export type SceneAudioGain = {
	/** 最上位Scene上での、この音量設定の内容時刻0。 */
	positionMs: number;
	/** 配置レイヤー自身の内容時刻での終端。子Sceneの長さとは独立する。 */
	endTimeMs: number;
	volume: TimelineParameterBinding;
	automationGraphs: AutomationGraph[];
};

export type SceneAudioClip = {
	assetId: string;
	volume: TimelineParameterBinding;
	automationGraphs: AutomationGraph[];
	/** 音量のEND_TIME。動画では映像・音声共通の素材長を使う。 */
	durationBasis: 'audio' | 'media';
	/** 最上位Scene上での素材時刻0。元のキーフレームや式の時刻は書き換えない。 */
	positionMs: number;
	startMs: number;
	endMs: number;
	gains: SceneAudioGain[];
};

/** 描画結果や音量に依存せず、祖先すべての表示区間の交差から音声の再生計画を作る。 */
export function getSceneAudioClips(scenes: readonly TimelineScene[], sceneId: string): SceneAudioClip[] {
	validateTimelineScenes(scenes);
	const clips: SceneAudioClip[] = [];
	const visit = (id: string, offset: number, start: number, end: number, gains: SceneAudioGain[]) => {
		const scene = getTimelineScene(scenes, id);
		end = Math.min(end, offset + getSceneDuration(scene));
		for (const layer of scene.layers) {
			const startMs = Math.max(start, offset + getTimelineLayerStart(layer));
			const endMs = Math.min(end, offset + getTimelineLayerEnd(layer));
			if (endMs <= startMs) continue;
			const positionMs = offset + layer.positionMs;
			if (layer.layerType === 'audio' || (layer.layerType === 'video' && layer.audioEnabled)) {
				clips.push({ assetId: layer.assetId,
					volume: layer.audioParamValues.volume,
					automationGraphs: layer.automationGraphs, durationBasis: layer.layerType === 'audio' ? 'audio' : 'media',
					positionMs, startMs, endMs, gains });
			}
			if (layer.layerType === 'scene') visit(layer.sceneId, positionMs, startMs, endMs, [...gains, {
				positionMs, endTimeMs: layer.trimStartMs + layer.trimmedDurationMs,
				volume: layer.audioParamValues.volume, automationGraphs: layer.automationGraphs,
			}]);
		}
	};
	visit(sceneId, 0, 0, Infinity, []);
	return clips;
}
