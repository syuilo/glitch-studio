import { findTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { getTimelineClipEnd, getTimelineClipMoveBounds, isTimelineClipActive, validateTimelineClips } from '@gs/subsystems_timeline_shared/timing.ts';
import { getTimelineKeyframeLanes } from './timeline-keyframe-lanes.ts';
import { clipSelectionKey, keyframeMoveBounds, keyframeSelectionKey } from './timeline-selection.ts';
import type { TimelineClipSelection, TimelineKeyframePosition } from './timeline-selection.ts';
import type { TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { ProjectState } from '../Project.ts';

export type TimelineClipMoveTarget = TimelineClipSelection & { initialStartMs?: number };

/** UIのスナップとCommandの適用で同じ移動範囲を使う。キーの所属は操作開始時にだけ決める。 */
export function prepareTimelineClipMove(state: Pick<ProjectState, 'visualModules'>, scene: TimelineScene,
	targets: readonly TimelineClipMoveTarget[], initialKeyframes?: readonly TimelineKeyframePosition[]) {
	if (new Set(targets.map(clipSelectionKey)).size !== targets.length) throw new Error('Duplicate clip move target');
	const clips: (TimelineClipSelection & { startMs: number })[] = [];
	const keyframes: TimelineKeyframePosition[] = [];
	let minDelta = -Infinity;
	let maxDelta = Infinity;
	for (const layerId of new Set(targets.map(target => target.layerId))) {
		const layer = findTimelineLayer(scene.layers, layerId);
		if (!layer || layer.layerType === 'group') throw new Error('Timeline clip layer not found');
		const layerTargets = targets.filter(target => target.layerId === layerId);
		const selectedIds = new Set(layerTargets.map(target => target.clipId));
		const initialClips = layer.clips.map(clip => {
			const target = layerTargets.find(target => target.clipId === clip.id);
			return { ...clip, startMs: target?.initialStartMs ?? clip.startMs };
		});
		validateTimelineClips(initialClips);
		for (const target of layerTargets) {
			const clip = initialClips.find(clip => clip.id === target.clipId);
			if (!clip) throw new Error('Timeline clip not found');
			clips.push({ layerId, clipId: clip.id, startMs: clip.startMs });
			const bounds = getTimelineClipMoveBounds(initialClips, selectedIds, clip.id);
			minDelta = Math.max(minDelta, bounds.minDelta);
			maxDelta = Math.min(maxDelta, bounds.maxDelta, Number.MAX_SAFE_INTEGER - getTimelineClipEnd(clip));
		}
		const savedPositions = new Map(initialKeyframes?.filter(point => point.layerId === layerId).map(point => [keyframeSelectionKey(point), point]));
		for (const lane of getTimelineKeyframeLanes(state, layer)) {
			const position = (point: { id: string; x: number }): TimelineKeyframePosition => ({ layerId, target: lane.target,
				paramPath: lane.paramPath, keyframeId: point.id, x: point.x });
			// 追従中のキーはすでに更新済みなので、境界計算にも開始時の時刻を復元する。
			const initialPoints = lane.keyframes.map(point => ({ ...point, x: savedPositions.get(keyframeSelectionKey(position(point)))?.x ?? point.x }));
			const moving = initialPoints.filter(point => {
				if (initialKeyframes != null) return savedPositions.has(keyframeSelectionKey(position(point)));
				// 半開区間内のクリップを優先する。接触した境界のキーは右側にだけ追従し、
				// 空白に面する終端キーは左側に追従する。複数選択でも一度だけ動かす。
				const owner = initialClips.find(clip => isTimelineClipActive(clip, point.x))
					?? initialClips.find(clip => getTimelineClipEnd(clip) === point.x);
				return owner != null && selectedIds.has(owner.id);
			});
			const movingIds = new Set(moving.map(point => point.id));
			for (const point of moving) {
				keyframes.push(position(point));
				const bounds = keyframeMoveBounds(initialPoints, movingIds, point.id);
				minDelta = Math.max(minDelta, bounds.minDelta);
				maxDelta = Math.min(maxDelta, bounds.maxDelta);
			}
		}
	}
	if (initialKeyframes != null && (keyframes.length !== initialKeyframes.length
		|| new Set(initialKeyframes.map(keyframeSelectionKey)).size !== initialKeyframes.length)) throw new Error('Timeline keyframe not found');
	return { clips, keyframes, minDelta, maxDelta };
}
