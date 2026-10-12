import { findTimelineLayerLocation } from './layer-tree.ts';
import { getSceneDuration, getTimelineScene } from './scenes.ts';
import { getTimelineClipEnd } from './timing.ts';
import { isTimelineAudioOutputLayer } from './timeline-audio.ts';
import { assignPreparedSpeech, getVoicevoxUtterancePlacements } from './layers/voicevox/voicevox-placement.ts';
import type { SpeechResolver, VoicevoxRequest } from './layers/voicevox/voicevox.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { TimelineParameterBinding, TimelineLayer, TimelineScene } from './types.ts';
import type { TimelineMediaSourceTiming } from './media-timing.ts';

export type SceneAudioGain = {
	/** 最上位Scene上で、音量を所有するSceneの時刻0が置かれる位置。 */
	sceneStartMs: number;
	volume: TimelineParameterBinding;
	automationGraphs: AutomationGraph[];
};

export type SceneAudioClip = {
	sourceId: string;
	/** 親Sceneで表示区間を切っても、素材の時計の原点と範囲は変更しない。 */
	sourceTiming: TimelineMediaSourceTiming;
	startMs: number;
	endMs: number;
	gains: SceneAudioGain[];
};

export type SceneAudioSelection = { type: 'all' } | { type: 'belowLayer'; layerId: string } | { type: 'layer'; layerId: string };

/** 音声の準備状況から独立した、最上位Scene上の配置。 */
export type SceneAudioPlacement = {
	startMs: number;
	endMs: number;
	gains: SceneAudioGain[];
} & ({ type: 'asset'; sourceId: string; sourceTiming: TimelineMediaSourceTiming } | { type: 'speech'; request: VoicevoxRequest; sourceStartMs: number });

/** 祖先クリップすべての表示区間を交差させ、素材と各階層の音量の時計を別々に展開する。 */
export function getSceneAudioPlacements(scenes: readonly TimelineScene[], sceneId: string, selection: SceneAudioSelection = { type: 'all' }): SceneAudioPlacement[] {
	const rootScene = getTimelineScene(scenes, sceneId);
	let rootLayers = rootScene.layers;
	if (selection.type !== 'all') {
		const location = findTimelineLayerLocation(rootScene.layers, selection.layerId);
		if (!location) throw new Error('Audio input layer not found in scene');
		if (selection.type === 'layer' && !isTimelineAudioOutputLayer(location.layer)) throw new Error('Layer has no audio output');
		// 祖先の音量は取得しないが、無効化は子孫の直接参照にも適用する。
		rootLayers = location.ancestors.some(parent => parent.isDisabled) ? []
			: selection.type === 'layer' ? [location.layer] : location.siblings.slice(location.index + 1);
		if (selection.type === 'belowLayer' && !location.ancestors.some(parent => parent.isDisabled)) {
			// Transformは音声にも合成境界を作らない。GroupまたはSceneの境界まで
			// 親の下の兄弟を追加し、映像の下層入力と同じ範囲を参照する。
			for (const parent of location.ancestors.toReversed()) {
				if (parent.layerType === 'group') break;
				const parentLocation = findTimelineLayerLocation(rootScene.layers, parent.id)!;
				rootLayers.push(...parentLocation.siblings.slice(parentLocation.index + 1));
			}
		}
	}
	const placements: SceneAudioPlacement[] = [];
	const visit = (layers: readonly TimelineLayer[], sceneStartMs: number, start: number, end: number, gains: SceneAudioGain[]) => {
		for (const layer of layers) {
			if (layer.isDisabled) continue;
			if (layer.layerType === 'transform') { visit(layer.layers, sceneStartMs, start, end, gains); continue; }
			if (!isTimelineAudioOutputLayer(layer)) continue;
			const layerGains = [...gains, { sceneStartMs, volume: layer.audioParamValues.volume, automationGraphs: layer.automationGraphs }];
			if (layer.layerType === 'group') {
				visit(layer.layers, sceneStartMs, start, end, layerGains);
				continue;
			}
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
				if ('sceneId' in clip) {
					const sourceStartMs = sceneStartMs + clip.startMs - clip.contentOffsetMs;
					const childScene = getTimelineScene(scenes, clip.sceneId);
					visit(childScene.layers, sourceStartMs, startMs, Math.min(endMs, sourceStartMs + getSceneDuration(childScene)), layerGains);
				} else if (!('audioEnabled' in clip) || clip.audioEnabled) {
					const sourceTiming = { startMs: sceneStartMs + clip.startMs, sourceInMs: clip.sourceInMs, sourceOutMs: clip.sourceOutMs, playbackRate: clip.playbackRate, loop: clip.loop };
					placements.push({ type: 'asset', sourceId: clip.assetId, sourceTiming, startMs, endMs, gains: layerGains });
				}
			}
		}
	};
	visit(rootLayers, 0, 0, getSceneDuration(rootScene), []);
	return placements;
}

export function resolveSceneAudioPlacements(placements: readonly SceneAudioPlacement[], resolveSpeech: SpeechResolver) {
	const clips: SceneAudioClip[] = [];
	const missingSpeech: Extract<SceneAudioPlacement, { type: 'speech' }>[] = [];
	for (const placement of placements) {
		if (placement.type === 'asset') {
			const { sourceId, sourceTiming, startMs, endMs, gains } = placement;
			clips.push({ sourceId, sourceTiming, startMs, endMs, gains });
		} else {
			const speech = resolveSpeech(placement.request);
			if (!speech) {
				missingSpeech.push(placement);
				continue;
			}
			const interval = assignPreparedSpeech(placement, speech);
			if (interval) clips.push({ sourceId: interval.sourceId, startMs: interval.startMs, endMs: interval.endMs, gains: placement.gains,
				sourceTiming: { startMs: interval.sourceStartMs, sourceInMs: 0, sourceOutMs: speech.durationMs, playbackRate: 1, loop: false } });
		}
	}
	return { clips, missingSpeech };
}

/** 再生は準備済みの音声だけを受け取る。未生成の配置は生成対象の列挙・書き出し検証側で扱う。 */
export function getSceneAudioClips(scenes: readonly TimelineScene[], sceneId: string, selection: SceneAudioSelection = { type: 'all' }, resolveSpeech: SpeechResolver = () => undefined): SceneAudioClip[] {
	return resolveSceneAudioPlacements(getSceneAudioPlacements(scenes, sceneId, selection), resolveSpeech).clips;
}
