import { paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { TimelineParameterTarget } from './timeline-scene.ts';
import type { TimelineClipSelection, TimelineKeyframeSelection } from './timeline-selection.ts';
import { timelineTimeToX, timelineKeyframePosition } from './timeline-coordinates.ts';

export type TimelineMarqueeAnchor = { layerId: string; offsetY: number };
export type TimelineLayerSelectionLayout = {
	clipLane: { top: number; bottom: number };
	keyframeLanes: Map<string, number>;
};
export type TimelineMarqueeLayer = {
	id: string;
	clips: readonly { id: string; startMs: number; durationMs: number }[];
	lanes: readonly { target: TimelineParameterTarget; paramPath: ParamPath; keyframes: readonly { id: string; x: number }[] }[];
};

export function timelineLaneKey(target: TimelineParameterTarget, paramPath: ParamPath): string {
	return JSON.stringify([target, paramPathKey(paramPath)]);
}

/** 境界行だけを計測する。各キーのDOMを走査せず、レーン共通の中心位置を保持する。 */
export function measureTimelineLayerSelection(element: HTMLElement): TimelineLayerSelectionLayout | null {
	const clipLane = element.querySelector<HTMLElement>('[data-timeline-clip-lane]');
	if (!clipLane) return null;
	const top = element.getBoundingClientRect().top;
	const clipRect = clipLane.getBoundingClientRect();
	const keyframeLanes = new Map<string, number>();
	for (const lane of element.querySelectorAll<HTMLElement>('[data-parameter-target]')) {
		const target = lane.dataset.parameterTarget;
		const path = lane.dataset.paramPath;
		if (!path || (target !== 'audio' && target !== 'module' && target !== 'compositing' && target !== 'effect' && target !== 'shape' && target !== 'text')) continue;
		const rect = lane.getBoundingClientRect();
		keyframeLanes.set(timelineLaneKey(target, JSON.parse(path) as ParamPath), (rect.top + rect.bottom) / 2 - top);
	}
	return { clipLane: { top: clipRect.top - top, bottom: clipRect.bottom - top }, keyframeLanes };
}

export function collectTimelineMarqueeCandidates(
	layers: readonly TimelineMarqueeLayer[],
	start: TimelineMarqueeAnchor,
	end: TimelineMarqueeAnchor,
	boundaryLayouts: ReadonlyMap<string, TimelineLayerSelectionLayout>,
	horizontal: { left: number; right: number; position: number; range: number; width: number },
): { clips: TimelineClipSelection[]; keyframes: TimelineKeyframeSelection[] } {
	const clips: TimelineClipSelection[] = [];
	const keyframes: TimelineKeyframeSelection[] = [];
	const startIndex = layers.findIndex(layer => layer.id === start.layerId);
	const endIndex = layers.findIndex(layer => layer.id === end.layerId);
	if (startIndex < 0 || endIndex < 0) return { clips, keyframes };
	const forward = startIndex < endIndex || (startIndex === endIndex && start.offsetY <= end.offsetY);
	const first = forward ? start : end;
	const last = forward ? end : start;
	const firstIndex = Math.min(startIndex, endIndex);
	const lastIndex = Math.max(startIndex, endIndex);
	const pixelsPerMs = horizontal.width / horizontal.range;
	const x = (time: number) => timelineTimeToX(time, horizontal.position, horizontal.range, horizontal.width);
	for (let index = firstIndex; index <= lastIndex; index++) {
		const layer = layers[index];
		const boundary = index === firstIndex || index === lastIndex;
		const measured = boundaryLayouts.get(layer.id);
		// 境界行は実測できるまで判定を確定しない。中間行には高さの推定すら不要。
		if (boundary && !measured) continue;
		const top = index === firstIndex ? first.offsetY : -Infinity;
		const bottom = index === lastIndex ? last.offsetY : Infinity;
		if (!boundary || (measured!.clipLane.bottom >= top && measured!.clipLane.top <= bottom)) {
			for (const clip of layer.clips) {
				const left = Math.max(0, x(clip.startMs));
				const right = Math.min(horizontal.width, x(clip.startMs + clip.durationMs));
				if (left <= right && left <= horizontal.right && right >= horizontal.left) clips.push({ layerId: layer.id, clipId: clip.id });
			}
		}
		for (const lane of layer.lanes) {
			if (boundary) {
				const y = measured!.keyframeLanes.get(timelineLaneKey(lane.target, lane.paramPath));
				if (y == null || y < top || y > bottom) continue;
			}
			for (const point of lane.keyframes) {
				const center = timelineKeyframePosition(point.x, pixelsPerMs) - horizontal.position * pixelsPerMs;
				if (center >= 0 && center <= horizontal.width && center >= horizontal.left && center <= horizontal.right) keyframes.push({ layerId: layer.id, target: lane.target, paramPath: lane.paramPath, keyframeId: point.id });
			}
		}
	}
	return { clips, keyframes };
}
