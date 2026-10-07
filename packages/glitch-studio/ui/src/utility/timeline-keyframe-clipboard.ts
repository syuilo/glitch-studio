import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import { resolveParameter } from '@gs/shared/parameter/parameter-path.ts';
import { validateTimelineParameterTree } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import { validateVoicevoxLayer } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import type { VoicevoxUtterance } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import { appendInlineKeyframes } from './keyframes-timeline.ts';
import { getLayerParameterDefinitions, getLayerParameterValues, resolveLayerParameter } from './timeline-scene.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { KeyframesDataType, KeyframesTimelineKeyframe } from '@gs/shared/keyframes/keyframes-timeline.ts';
import type { TimelineScene, TimelineParameterTarget } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineEffectParameterBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { ProjectState } from '../Project.ts';
import type { TimelineKeyframeSelection } from './timeline-selection.ts';

export type TimelineKeyframePaste = {
	layerId: string;
	target: TimelineParameterTarget;
	paramPath: ParamPath;
	dataType: KeyframesDataType;
	keyframe: KeyframesTimelineKeyframe;
} | {
	layerId: string;
	target: 'utterance';
	paramPath: ParamPath;
	utterance: VoicevoxUtterance;
};

export type TimelineKeyframeClipboard = {
	kind: 'keyframes';
	scene: TimelineScene;
	keyframes: TimelineKeyframePaste[];
};

type ParameterUpdate = {
	layerId: string;
	target: TimelineParameterTarget;
	paramId: string;
	before: TimelineEffectParameterBinding | undefined;
	after: TimelineEffectParameterBinding;
};
type UtteranceUpdate = { layerId: string; target: 'utterance'; before: VoicevoxUtterance[]; after: VoicevoxUtterance[] };

type ParameterState = Pick<ProjectState, 'visualModules'>;

export function copyTimelineKeyframes(state: ParameterState, scene: TimelineScene, selection: readonly TimelineKeyframeSelection[]): TimelineKeyframeClipboard | null {
	if (selection.length === 0) return null;
	const keyframes: TimelineKeyframePaste[] = [];
	try {
		for (const point of selection) {
			const layer = scene.layers.find(layer => layer.id === point.layerId);
			if (!layer) return null;
			if (point.target === 'utterance') {
				if (layer.layerType !== 'voicevox') return null;
				const utterance = layer.utterances.find(utterance => utterance.id === point.keyframeId);
				if (!utterance) return null;
				keyframes.push(deepClone({ layerId: point.layerId, target: 'utterance', paramPath: ['utterances'], utterance }));
				continue;
			}
			const binding = resolveLayerParameter(state, layer, point.target, point.paramPath).value;
			if (binding.inputSource !== 'keyframesTimelineInline') return null;
			const keyframe = binding.keyframesTimeline.keyframes.find(keyframe => keyframe.id === point.keyframeId);
			if (!keyframe) return null;
			keyframes.push(deepClone({ layerId: point.layerId, target: point.target, paramPath: point.paramPath,
				dataType: binding.keyframesTimeline.dataType, keyframe }));
		}
	} catch { return null; }
	return { kind: 'keyframes', scene, keyframes };
}

/** UIの事前確認とCommandで同じ検証を使い、全ルートの変更案を保存前に確定する。 */
export function getTimelineKeyframePasteUpdates(state: ParameterState, scene: TimelineScene, keyframes: readonly TimelineKeyframePaste[]): (ParameterUpdate | UtteranceUpdate)[] | null {
	if (keyframes.length === 0) return null;
	const updates = new Map<string, ParameterUpdate>();
	const speechUpdates = new Map<string, UtteranceUpdate>();
	const lanes = new Map<string, Exclude<TimelineKeyframePaste, { target: 'utterance' }>[]>();
	for (const entry of keyframes) {
		if (entry.target === 'utterance') {
			const layer = scene.layers.find(layer => layer.id === entry.layerId);
			if (layer?.layerType !== 'voicevox' || entry.paramPath.length !== 1 || entry.paramPath[0] !== 'utterances') return null;
			const update = speechUpdates.get(layer.id) ?? { layerId: layer.id, target: 'utterance', before: deepClone(layer.utterances), after: deepClone(layer.utterances) };
			update.after.push(deepClone(entry.utterance));
			speechUpdates.set(layer.id, update);
			continue;
		}
		const key = JSON.stringify([entry.layerId, entry.target, entry.paramPath]);
		const lane = lanes.get(key);
		if (lane) lane.push(entry);
		else lanes.set(key, [entry]);
	}
	try {
		for (const update of speechUpdates.values()) {
			const layer = scene.layers.find(layer => layer.id === update.layerId)!;
			if (layer.layerType === 'voicevox') validateVoicevoxLayer({ voicevox: layer.voicevox, utterances: update.after });
		}
		for (const lane of lanes.values()) {
			const entry = lane[0];
			const layer = scene.layers.find(layer => layer.id === entry.layerId);
			if (!layer) return null;
			const defs = getLayerParameterDefinitions(state, layer, entry.target);
			const paramId = entry.paramPath[0];
			const key = JSON.stringify([entry.layerId, entry.target, paramId]);
			let update = updates.get(key);
			if (!update) {
				const before = getLayerParameterValues(layer, entry.target)[paramId];
				update = { layerId: layer.id, target: entry.target, paramId, before: deepClone(before),
					after: deepClone(resolveLayerParameter(state, layer, entry.target, [paramId]).value) };
				updates.set(key, update);
			}
			const draft = { [paramId]: update.after };
			const resolved = resolveParameter<TimelineEffectParameterBinding>(defs, draft, entry.paramPath);
			if (resolved.value.inputSource !== 'keyframesTimelineInline') return null;
			// enumの選択肢変更は追加する値を最新の定義で検証する。既存の古いキーは保持する。
			if (!lane.every(point => (point.dataType.kind === 'enum' && resolved.def.dataType.kind === 'enum')
				|| areDataTypesEqual(point.dataType, resolved.def.dataType))) return null;
			const next = appendInlineKeyframes(resolved.value, resolved.def, lane.map(point => point.keyframe));
			if (!next) return null;
			resolved.setValue(next);
			update.after = draft[paramId];
			validateTimelineParameterTree(defs[paramId], update.after, entry.target === 'effect', entry.target === 'effect' || entry.target === 'module');
		}
	} catch { return null; }
	// 配列・構造体の別レーンも同じルートへまとめ、順番に保存して上書きし合わないようにする。
	return [...updates.values(), ...speechUpdates.values()];
}

export function getPastedTimelineKeySelection(entry: TimelineKeyframePaste): TimelineKeyframeSelection {
	return { layerId: entry.layerId, target: entry.target, paramPath: entry.paramPath, keyframeId: entry.target === 'utterance' ? entry.utterance.id : entry.keyframe.id };
}

export function prepareTimelineKeyframePaste(state: ParameterState, scene: TimelineScene, clipboard: TimelineKeyframeClipboard, timeMs: number): TimelineKeyframePaste[] | null {
	if (scene !== clipboard.scene || clipboard.keyframes.length === 0 || !Number.isFinite(timeMs)) return null;
	const startMs = Math.round(timeMs);
	const firstTime = Math.min(...clipboard.keyframes.map(entry => entry.target === 'utterance' ? entry.utterance.timeMs : entry.keyframe.x));
	const keyframes = clipboard.keyframes.map(entry => entry.target === 'utterance' ? { ...deepClone(entry),
		utterance: { ...deepClone(entry.utterance), id: genId(), timeMs: startMs + entry.utterance.timeMs - firstTime },
	} : { ...deepClone(entry), keyframe: { ...deepClone(entry.keyframe), id: genId(), x: startMs + entry.keyframe.x - firstTime } });
	return getTimelineKeyframePasteUpdates(state, scene, keyframes) ? keyframes : null;
}
