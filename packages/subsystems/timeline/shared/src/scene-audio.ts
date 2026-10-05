import { getSceneDuration, getTimelineScene, validateTimelineScenes } from './scenes.ts';
import { getTimelineClipEnd } from './timing.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { TimelineParameterBinding, TimelineScene } from './types.ts';

export type SceneAudioGain = {
	/** 最上位Scene上で、音量を所有するSceneの時刻0が置かれる位置。 */
	sceneStartMs: number;
	volume: TimelineParameterBinding;
	automationGraphs: AutomationGraph[];
};

export type SceneAudioClip = {
	assetId: string;
	/** 最上位Scene上での素材時刻0。音量の評価基準には使用しない。 */
	sourceStartMs: number;
	startMs: number;
	endMs: number;
	gains: SceneAudioGain[];
};

/** 祖先クリップすべての表示区間を交差させ、素材と各階層の音量の時計を別々に展開する。 */
export function getSceneAudioClips(scenes: readonly TimelineScene[], sceneId: string, belowLayerId?: string): SceneAudioClip[] {
	validateTimelineScenes(scenes);
	const rootScene = getTimelineScene(scenes, sceneId);
	const boundary = belowLayerId == null ? -1 : rootScene.layers.findIndex(layer => layer.id === belowLayerId);
	if (belowLayerId != null && boundary === -1) throw new Error('Audio input layer not found');
	const clips: SceneAudioClip[] = [];
	const visit = (id: string, sceneStartMs: number, start: number, end: number, gains: SceneAudioGain[]) => {
		const scene = getTimelineScene(scenes, id);
		end = Math.min(end, sceneStartMs + getSceneDuration(scene));
		// 境界は取得元Sceneの直下だけに適用する。下層の子Sceneは音声全体を出力する。
		const layers = gains.length === 0 ? scene.layers.slice(boundary + 1) : scene.layers;
		for (const layer of layers) {
			if (layer.isDisabled) continue;
			if (layer.layerType !== 'audio' && layer.layerType !== 'video' && layer.layerType !== 'scene') continue;
			const layerGains = [...gains, { sceneStartMs, volume: layer.audioParamValues.volume, automationGraphs: layer.automationGraphs }];
			for (const clip of layer.clips) {
				const startMs = Math.max(start, sceneStartMs + clip.startMs);
				const endMs = Math.min(end, sceneStartMs + getTimelineClipEnd(clip));
				if (endMs <= startMs) continue;
				// 子Sceneの時刻0と素材の時刻0は同じ変換式だが、親レイヤーのキーは
				// 親Sceneに固定する。トリムしても親の音量キーまで移動してはいけない。
				const sourceStartMs = sceneStartMs + clip.startMs - clip.contentOffsetMs;
				if ('sceneId' in clip) {
					visit(clip.sceneId, sourceStartMs, startMs, endMs, layerGains);
				} else if (!('audioEnabled' in clip) || clip.audioEnabled) {
					clips.push({ assetId: clip.assetId, sourceStartMs, startMs, endMs, gains: layerGains });
				}
			}
		}
	};
	visit(sceneId, 0, 0, Infinity, []);
	return clips;
}
