import { getSceneDuration, getTimelineScene, validateTimelineScenes } from './scenes.ts';
import { getTimelineClipEnd } from './timing.ts';
import type { AutomationGraph } from '@glitch/shared/types.js';
import type { TimelineParameterBinding, TimelineScene } from './types.ts';

export type SceneAudioGain = {
	/** 最上位Scene上で、音量を所有するSceneの時刻0が置かれる位置。 */
	sceneStartMs: number;
	volume: TimelineParameterBinding;
	automationGraphs: AutomationGraph[];
};

export type SceneAudioClip = {
	assetId: string;
	durationBasis: 'audio' | 'media';
	/** 最上位Scene上での素材時刻0。音量の評価基準には使用しない。 */
	sourceStartMs: number;
	startMs: number;
	endMs: number;
	gains: SceneAudioGain[];
};

/** 祖先クリップすべての表示区間を交差させ、素材と各階層の音量の時計を別々に展開する。 */
export function getSceneAudioClips(scenes: readonly TimelineScene[], sceneId: string): SceneAudioClip[] {
	validateTimelineScenes(scenes);
	const clips: SceneAudioClip[] = [];
	const visit = (id: string, sceneStartMs: number, start: number, end: number, gains: SceneAudioGain[]) => {
		const scene = getTimelineScene(scenes, id);
		end = Math.min(end, sceneStartMs + getSceneDuration(scene));
		for (const layer of scene.layers) {
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
					clips.push({ assetId: clip.assetId, durationBasis: layer.layerType === 'audio' ? 'audio' : 'media',
																		sourceStartMs, startMs, endMs, gains: layerGains });
				}
			}
		}
	};
	visit(sceneId, 0, 0, Infinity, []);
	return clips;
}
