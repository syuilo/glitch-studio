import { findTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { resolveParameter } from '@gs/shared/parameter/parameter-path.ts';
import { validateTimelineParameterTree } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import { validateVoicevoxLayer } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import { getLayerParameterDefinitions, getLayerParameterValues } from './timeline-scene.ts';
import { keyframeSelectionKey } from './timeline-selection.ts';
import type { TimelineKeyframePosition } from './timeline-selection.ts';
import type { EditableTimelineParameterBinding } from '../types/parameter-edit.ts';
import type { TimelineScene, TimelineVoicevoxLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { ProjectState } from '../Project.ts';

/** Commandが分離したSceneを編集する。クリップとキーに対する検証がすべて成功した時点で反映される。 */
export function moveTimelineKeyframesInDraft(state: Pick<ProjectState, 'nodesEffects'>, draftScene: TimelineScene,
	positions: readonly TimelineKeyframePosition[]): void {
	if (new Set(positions.map(keyframeSelectionKey)).size !== positions.length) throw new Error('Duplicate keyframe move target');
	const movedUtteranceLayers = new Set<TimelineVoicevoxLayer>();
	for (const position of positions) {
		const layer = findTimelineLayer(draftScene.layers, position.layerId);
		if (layer == null || !Number.isSafeInteger(position.x) || position.x < 0) throw new Error('Invalid keyframe move');
		if (position.target === 'utterance') {
			if (layer.layerType !== 'voicevox' || position.paramPath.length !== 1 || position.paramPath[0] !== 'utterances') throw new Error('Invalid utterance target');
			const utterance = layer.utterances.find(utterance => utterance.id === position.keyframeId);
			if (utterance == null) throw new Error('Utterance not found');
			utterance.timeMs = position.x;
			movedUtteranceLayers.add(layer);
			continue;
		}
		const values = getLayerParameterValues(layer, position.target);
		const rootKey = position.paramPath[0];
		const rootBinding = values[rootKey];
		if (rootBinding == null) throw new Error('Timeline keyframe not found');
		const definitions = getLayerParameterDefinitions(state, layer, position.target);
		const binding = resolveParameter<EditableTimelineParameterBinding>(definitions, values, position.paramPath).value;
		const keyframe = binding.inputSource === 'keyframesTimelineInline' ? binding.keyframesTimeline.keyframes.find(keyframe => keyframe.id === position.keyframeId) : null;
		if (keyframe == null) throw new Error('Timeline keyframe not found');
		keyframe.x = position.x;
		validateTimelineParameterTree(definitions[rootKey], rootBinding, position.target === 'effect');
	}
	for (const layer of movedUtteranceLayers) validateVoicevoxLayer(layer);
}
