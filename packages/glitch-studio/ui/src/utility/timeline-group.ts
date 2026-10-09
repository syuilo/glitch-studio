import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { flattenTimelineLayers, getTimelineClipLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { getTimelineKeyframeEntries } from './timeline-keyframe-lanes.ts';
import type { TimelineGroupLayer, TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { ProjectState } from '../Project.ts';

/** グループに含まれる全キーを対象にし、クリップ内への所属判定や別Sceneへの再帰は行わない。 */
export function prepareTimelineGroupMove(state: Pick<ProjectState, 'visualModules'>, group: TimelineGroupLayer) {
	const layers = flattenTimelineLayers([group]);
	const clips = getTimelineClipLayers([group]).flatMap(layer => layer.clips.map(clip => ({ layerId: layer.id, clipId: clip.id,
		startMs: clip.startMs, endMs: clip.startMs + clip.durationMs })));
	const keyframes = getTimelineKeyframeEntries(state, layers).map(entry => ({ ...entry.selection, x: entry.time }));
	const times = [...clips.map(clip => clip.startMs), ...keyframes.map(point => point.x)];
	// 発話キーだけでなく保存する字幕終端も安全な整数の範囲へ収める。
	const subtitleEnds = layers.flatMap(layer => layer.layerType === 'voicevox' ? layer.utterances
		.filter(utterance => utterance.subtitleDuration.mode === 'specified')
		.map(utterance => utterance.timeMs + (utterance.subtitleDuration.mode === 'specified' ? utterance.subtitleDuration.durationMs : 0)) : []);
	const ends = [...clips.map(clip => clip.endMs), ...keyframes.map(point => point.x), ...subtitleEnds];
	return { clips, keyframes, minDelta: times.length ? -times.reduce((min, time) => Math.min(min, time), Infinity) : 0,
		maxDelta: ends.length ? Number.MAX_SAFE_INTEGER - ends.reduce((max, time) => Math.max(max, time), 0) : 0 };
}

export type TimelineGroupMove = ReturnType<typeof prepareTimelineGroupMove>;

/** 保存されたBinding内の参照だけを付け替え、式・共有Visual Module・参照先Sceneは変更しない。 */
export function duplicateTimelineLayers(source: readonly TimelineLayer[]): TimelineLayer[] {
	const result = deepClone([...source]);
	const layers = flattenTimelineLayers(result);
	const ids = new Map(layers.map(layer => [layer.id, genId()]));
	const remapReferences = (value: unknown): void => {
		if (!value || typeof value !== 'object') return;
		if (Array.isArray(value)) { for (const item of value) remapReferences(item); return; }
		const record = value as Record<string, unknown>;
		if (record.inputSource === 'layerAudio' && typeof record.layerId === 'string' && ids.has(record.layerId)) record.layerId = ids.get(record.layerId)!;
		for (const item of Object.values(record)) remapReferences(item);
	};
	for (const layer of layers) {
		layer.id = ids.get(layer.id)!;
		if (layer.layerType !== 'group') for (const clip of layer.clips) clip.id = genId();
		if ('effectParamValues' in layer) remapReferences(layer.effectParamValues);
		if ('visualModuleParamValues' in layer) remapReferences(layer.visualModuleParamValues);
	}
	return result;
}
