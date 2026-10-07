import { getLayerKeyframeParameters } from './timeline-scene.ts';
import type { ProjectState } from '../Project.ts';
import type { TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineKeyTarget, TimelineKeyframeSelection } from './timeline-selection.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';

/** 選択・スナップ・前後移動に必要な位置だけを公開し、発話を通常のBindingとして扱わない。 */
export function getTimelineKeyframeLanes(state: Pick<ProjectState, 'visualModules'>, layer: TimelineLayer): {
	target: TimelineKeyTarget; paramPath: ParamPath; keyframes: { id: string; x: number }[];
}[] {
	const lanes = getLayerKeyframeParameters(state, layer).map(param => ({ target: param.target, paramPath: param.paramPath, keyframes: param.binding.keyframesTimeline.keyframes }));
	return layer.layerType === 'voicevox' ? [
		{ target: 'utterance', paramPath: ['utterances'], keyframes: layer.utterances.map(utterance => ({ id: utterance.id, x: utterance.timeMs })) },
		...lanes,
	] : lanes;
}

export function getTimelineKeyframeEntries(state: Pick<ProjectState, 'visualModules'>, layers: readonly TimelineLayer[]) {
	return layers.flatMap(layer => getTimelineKeyframeLanes(state, layer).flatMap(lane => lane.keyframes.map(point => ({
		selection: { layerId: layer.id, target: lane.target, paramPath: lane.paramPath, keyframeId: point.id } satisfies TimelineKeyframeSelection,
		x: point.x, time: point.x, keyframes: lane.keyframes,
	}))));
}
