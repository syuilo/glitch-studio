import { getTimelineFittedExtent, getTimelineLayerCorners, rotateTimelineVector, timelineSourceToScene } from '@gs/subsystems_timeline_shared/layer-transform.ts';
import type { TimelineLayerGeometry, TimelineLayerTransform, TimelinePoint } from '@gs/subsystems_timeline_shared/layer-transform.ts';

export type PreviewCanvasRect = { left: number; top: number; width: number; height: number };

export const previewResizeHandles: TimelinePoint[] = [[-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0]];

export function sceneToPreview(point: TimelinePoint, rect: PreviewCanvasRect): TimelinePoint {
	return [rect.left + (point[0] + 1) * rect.width / 2, rect.top + (1 - point[1]) * rect.height / 2];
}

export function previewDeltaToScene(delta: TimelinePoint, rect: PreviewCanvasRect): TimelinePoint {
	return [delta[0] * 2 / rect.width, -delta[1] * 2 / rect.height];
}

const clampScale = (value: number, previous: number) => Math.sign(previous) * Math.max(0.000001, value * Math.sign(previous));

function positionForFixedPoint(geometry: TimelineLayerGeometry, fixedPoint: TimelinePoint, scale: TimelinePoint): TimelinePoint {
	const fixedScene = timelineSourceToScene(fixedPoint, geometry);
	const withScale = { ...geometry, transform: { ...geometry.transform, position: [0, 0] as TimelinePoint, scale } };
	const shifted = timelineSourceToScene(fixedPoint, withScale);
	return [fixedScene[0] - shifted[0], fixedScene[1] - shifted[1]];
}

/**
 * ポインターの差分を開始時の回転・fitで逆変換する。前回の更新値へ加算しないことで、
 * 丸め誤差やWorkerの遅延を累積させず、originが中央以外でも反対側を固定する。
 */
export function resizePreviewLayer(geometry: TimelineLayerGeometry, handle: TimelinePoint, delta: TimelinePoint, keepRatio: boolean, fromOrigin: boolean): TimelineLayerTransform {
	const initial = geometry.transform;
	const fixed: TimelinePoint = fromOrigin ? initial.origin : [-handle[0], -handle[1]];
	const extent = getTimelineFittedExtent(geometry.sourceSize, geometry.sceneSize, initial.fitMode);
	const localDelta = rotateTimelineVector(delta, -initial.rotation, geometry.sceneSize);
	const denominator = handle.map((value, axis) => (value - fixed[axis]) * extent[axis]);
	let scale: TimelinePoint = [...initial.scale];
	if (keepRatio && handle[0] !== 0 && handle[1] !== 0) {
		const aspect = geometry.sceneSize.width / geometry.sceneSize.height;
		const before = [denominator[0] * initial.scale[0] * aspect, denominator[1] * initial.scale[1]];
		const squared = before[0] ** 2 + before[1] ** 2;
		const factor = squared === 0 ? 1 : Math.max(0.000001, 1 + (localDelta[0] * aspect * before[0] + localDelta[1] * before[1]) / squared);
		scale = [initial.scale[0] * factor, initial.scale[1] * factor];
	} else {
		for (const axis of [0, 1] as const) {
			if (handle[axis] !== 0 && Math.abs(denominator[axis]) > 0.000001) scale[axis] = clampScale(initial.scale[axis] + localDelta[axis] / denominator[axis], initial.scale[axis]);
		}
	}
	return { ...initial, scale, position: fromOrigin ? [...initial.position] : positionForFixedPoint(geometry, fixed, scale) };
}

/** 移動では回転後の枠の外接矩形を画面端へ吸着させる。許容距離はCSS pxで一定。 */
export function snapPreviewLayerMove(geometry: TimelineLayerGeometry, rect: PreviewCanvasRect, threshold = 6): TimelineLayerTransform {
	const corners = getTimelineLayerCorners(geometry);
	const position: TimelinePoint = [...geometry.transform.position];
	for (const axis of [0, 1] as const) {
		let best = threshold * 2 / (axis === 0 ? rect.width : rect.height);
		let correction = 0;
		for (const bound of [Math.min(...corners.map(point => point[axis])), Math.max(...corners.map(point => point[axis]))]) {
			for (const edge of [-1, 1]) {
				if (Math.abs(edge - bound) < best) { best = Math.abs(edge - bound); correction = edge - bound; }
			}
		}
		position[axis] += correction;
	}
	return { ...geometry.transform, position };
}

/**
 * 拡縮時も支点を保つ。倍率に対して各角の位置は一次式なので、画面端との交点を求め、
 * 掴んだハンドルが最も近くなる候補だけを採用する。回転・反転・比率固定でも使える。
 */
export function snapPreviewLayerResize(initial: TimelineLayerGeometry, transform: TimelineLayerTransform, handle: TimelinePoint,
	keepRatio: boolean, fromOrigin: boolean, rect: PreviewCanvasRect): TimelineLayerTransform {
	const fixed: TimelinePoint = fromOrigin ? initial.transform.origin : [-handle[0], -handle[1]];
	const toTransform = (scale: TimelinePoint): TimelineLayerTransform => ({ ...transform, scale,
		position: fromOrigin ? [...initial.transform.position] : positionForFixedPoint(initial, fixed, scale) });
	const current = { ...initial, transform };
	const corners = getTimelineLayerCorners(current);
	const currentHandle = sceneToPreview(timelineSourceToScene(handle, current), rect);
	let result = transform;
	let nearest = 6;
	const variables = keepRatio && handle.every(value => value !== 0) ? ['ratio'] as const : [0, 1] as const;
	for (const variable of variables) {
		if (variable !== 'ratio' && handle[variable] === 0) continue;
		const increment: TimelinePoint = variable === 'ratio' ? [...transform.scale] : variable === 0 ? [1, 0] : [0, 1];
		const next = toTransform([transform.scale[0] + increment[0], transform.scale[1] + increment[1]]);
		const nextCorners = getTimelineLayerCorners({ ...initial, transform: next });
		for (let corner = 0; corner < 4; corner++) for (const axis of [0, 1] as const) for (const edge of [-1, 1]) {
			const slope = nextCorners[corner][axis] - corners[corner][axis];
			if (Math.abs(slope) < 0.000001) continue;
			const amount = (edge - corners[corner][axis]) / slope;
			const scale: TimelinePoint = [transform.scale[0] + increment[0] * amount, transform.scale[1] + increment[1] * amount];
			if (scale.some((value, index) => value * Math.sign(initial.transform.scale[index]) < 0.000001)) continue;
			const candidate = toTransform(scale);
			const candidateHandle = sceneToPreview(timelineSourceToScene(handle, { ...initial, transform: candidate }), rect);
			const distance = Math.hypot(candidateHandle[0] - currentHandle[0], candidateHandle[1] - currentHandle[1]);
			if (distance < nearest) { nearest = distance; result = candidate; }
		}
	}
	return result;
}

export function unwrapPreviewRotation(previous: number, next: number): number {
	let delta = next - previous;
	while (delta > Math.PI) delta -= 2 * Math.PI;
	while (delta < -Math.PI) delta += 2 * Math.PI;
	return delta;
}
