import { getSceneDuration, getTimelineScene, validateTimelineScenes } from './scenes.ts';
import { getTimelineClipEnd } from './timing.ts';
import { isTimelineAudioOutputLayer } from './timeline-audio.ts';
import { assignPreparedSpeech, getVoicevoxUtterancePlacements } from './layers/voicevox/voicevox-placement.ts';
import type { SpeechResolver, VoicevoxRequest } from './layers/voicevox/voicevox.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { TimelineParameterBinding, TimelineScene } from './types.ts';

export type SceneAudioGain = {
	/** 最上位Scene上で、音量を所有するSceneの時刻0が置かれる位置。 */
	sceneStartMs: number;
	volume: TimelineParameterBinding;
	automationGraphs: AutomationGraph[];
};

export type SceneAudioClip = {
	sourceId: string;
	/** 最上位Scene上での素材時刻0。音量の評価基準には使用しない。 */
	sourceStartMs: number;
	startMs: number;
	endMs: number;
	gains: SceneAudioGain[];
};

export type SceneAudioSelection = { type: 'all' } | { type: 'belowLayer'; layerId: string } | { type: 'layer'; layerId: string };

/** 音声の準備状況から独立した、最上位Scene上の配置。 */
export type SceneAudioPlacement = {
	sourceStartMs: number;
	startMs: number;
	endMs: number;
	gains: SceneAudioGain[];
} & ({ type: 'asset'; sourceId: string } | { type: 'speech'; request: VoicevoxRequest });

/** 祖先クリップすべての表示区間を交差させ、素材と各階層の音量の時計を別々に展開する。 */
export function getSceneAudioPlacements(scenes: readonly TimelineScene[], sceneId: string, selection: SceneAudioSelection = { type: 'all' }): SceneAudioPlacement[] {
	validateTimelineScenes(scenes);
	const rootScene = getTimelineScene(scenes, sceneId);
	let rootLayers = rootScene.layers;
	if (selection.type !== 'all') {
		const index = rootLayers.findIndex(layer => layer.id === selection.layerId);
		if (index === -1) throw new Error('Audio input layer not found in scene');
		if (selection.type === 'layer' && !isTimelineAudioOutputLayer(rootLayers[index])) throw new Error('Layer has no audio output');
		rootLayers = selection.type === 'layer' ? [rootLayers[index]] : rootLayers.slice(index + 1);
	}
	const placements: SceneAudioPlacement[] = [];
	const visit = (id: string, sceneStartMs: number, start: number, end: number, gains: SceneAudioGain[]) => {
		const scene = getTimelineScene(scenes, id);
		end = Math.min(end, sceneStartMs + getSceneDuration(scene));
		// 選択は取得元Sceneの直下だけに適用する。Sceneレイヤーは子Sceneの音声全体を出力する。
		const layers = gains.length === 0 ? rootLayers : scene.layers;
		for (const layer of layers) {
			if (layer.isDisabled) continue;
			if (!isTimelineAudioOutputLayer(layer)) continue;
			const layerGains = [...gains, { sceneStartMs, volume: layer.audioParamValues.volume, automationGraphs: layer.automationGraphs }];
			if (layer.layerType === 'voicevox') {
				for (const placement of getVoicevoxUtterancePlacements(layer.voicevox, layer.utterances, layer.clips)) {
					const sourceStartMs = sceneStartMs + placement.sourceStartMs;
					const startMs = Math.max(start, sceneStartMs + placement.startMs);
					const endMs = Math.min(end, sceneStartMs + placement.endMs);
					if (endMs > startMs) placements.push({ type: 'speech', request: placement.request, sourceStartMs, startMs, endMs, gains: layerGains });
				}
				continue;
			}
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
					placements.push({ type: 'asset', sourceId: clip.assetId, sourceStartMs, startMs, endMs, gains: layerGains });
				}
			}
		}
	};
	visit(sceneId, 0, 0, Infinity, []);
	return placements;
}

export function resolveSceneAudioPlacements(placements: readonly SceneAudioPlacement[], resolveSpeech: SpeechResolver) {
	const clips: SceneAudioClip[] = [];
	const missingSpeech: Extract<SceneAudioPlacement, { type: 'speech' }>[] = [];
	for (const placement of placements) {
		if (placement.type === 'asset') {
			const { sourceId, sourceStartMs, startMs, endMs, gains } = placement;
			clips.push({ sourceId, sourceStartMs, startMs, endMs, gains });
		} else {
			const speech = resolveSpeech(placement.request);
			if (!speech) {
				missingSpeech.push(placement);
				continue;
			}
			const interval = assignPreparedSpeech(placement, speech);
			if (interval) clips.push({ ...interval, gains: placement.gains });
		}
	}
	return { clips, missingSpeech };
}

/** 再生は準備済みの音声だけを受け取る。未生成の配置は生成対象の列挙・書き出し検証側で扱う。 */
export function getSceneAudioClips(scenes: readonly TimelineScene[], sceneId: string, selection: SceneAudioSelection = { type: 'all' }, resolveSpeech: SpeechResolver = () => undefined): SceneAudioClip[] {
	return resolveSceneAudioPlacements(getSceneAudioPlacements(scenes, sceneId, selection), resolveSpeech).clips;
}
