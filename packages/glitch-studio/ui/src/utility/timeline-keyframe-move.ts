import { findTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { resolveParameter } from '@gs/shared/parameter/parameter-path.ts';
import { validateTimelineParameterTree } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import { validateVoicevoxLayer } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import { getLayerParameterDefinitions, getLayerParameterValues, resolveLayerParameter } from './timeline-scene.ts';
import { keyframeSelectionKey } from './timeline-selection.ts';
import type { TimelineKeyframePosition } from './timeline-selection.ts';
import type { TimelineEffectParameterBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { TimelineScene, TimelineParameterTarget } from '@gs/subsystems_timeline_shared/types.ts';
import type { VoicevoxUtterance } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import type { ProjectState } from '../Project.ts';

type ParameterUpdate = { layerId: string; target: TimelineParameterTarget; paramId: string;
	before: TimelineEffectParameterBinding | undefined; after: TimelineEffectParameterBinding };
type UtteranceUpdate = { layerId: string; target: 'utterance'; before: VoicevoxUtterance[]; after: VoicevoxUtterance[] };
export type TimelineKeyframeMoveUpdate = ParameterUpdate | UtteranceUpdate;

/** クリップとキーをまとめて検証できるよう、保存先を変更せず更新案だけを作る。 */
export function prepareTimelineKeyframeMove(state: Pick<ProjectState, 'visualModules'>, scene: TimelineScene,
	positions: readonly TimelineKeyframePosition[]): TimelineKeyframeMoveUpdate[] {
	if (new Set(positions.map(keyframeSelectionKey)).size !== positions.length) throw new Error('Duplicate keyframe move target');
	const parameters = new Map<string, ParameterUpdate>();
	const speeches = new Map<string, UtteranceUpdate>();
	for (const position of positions) {
		const layer = findTimelineLayer(scene.layers, position.layerId);
		if (!layer || !Number.isSafeInteger(Math.round(position.x)) || position.x < 0) throw new Error('Invalid keyframe move');
		if (position.target === 'utterance') {
			if (layer.layerType !== 'voicevox' || position.paramPath.length !== 1 || position.paramPath[0] !== 'utterances') throw new Error('Invalid utterance target');
			const update = speeches.get(layer.id) ?? { layerId: layer.id, target: 'utterance', before: deepClone(layer.utterances), after: deepClone(layer.utterances) };
			const utterance = update.after.find(utterance => utterance.id === position.keyframeId);
			if (!utterance) throw new Error('Utterance not found');
			utterance.timeMs = Math.round(position.x);
			speeches.set(layer.id, update);
			continue;
		}
		const paramId = position.paramPath[0];
		const rootKey = JSON.stringify([layer.id, position.target, paramId]);
		const update = parameters.get(rootKey) ?? { layerId: layer.id, target: position.target, paramId,
			before: deepClone(getLayerParameterValues(layer, position.target)[paramId]),
			after: deepClone(resolveLayerParameter(state, layer, position.target, [paramId]).value) };
		const definitions = getLayerParameterDefinitions(state, layer, position.target);
		// 同じ配列・構造体の別レーンも一つの案にまとめる。未設定の引数は既定値の
		// 独立したコピーへ書き込み、共有定義を変更せずUndoで未設定へ戻せるようにする。
		const binding = resolveParameter<TimelineEffectParameterBinding>(definitions, { [paramId]: update.after }, position.paramPath).value;
		const point = binding.inputSource === 'keyframesTimelineInline' ? binding.keyframesTimeline.keyframes.find(point => point.id === position.keyframeId) : undefined;
		if (!point) throw new Error('Timeline keyframe not found');
		point.x = Math.round(position.x);
		validateTimelineParameterTree(definitions[paramId], update.after, position.target === 'effect', position.target === 'effect' || position.target === 'module');
		parameters.set(rootKey, update);
	}
	for (const update of speeches.values()) {
		const layer = findTimelineLayer(scene.layers, update.layerId)!;
		if (layer.layerType === 'voicevox') validateVoicevoxLayer({ voicevox: layer.voicevox, utterances: update.after });
	}
	return [...parameters.values(), ...speeches.values()];
}
