import { transformTimelinePoint, multiplyTimelineAffine } from './affine.ts';
import { CAMERA_NEAR_DISTANCE } from './layers/camera/camera.ts';
import type { EvaluatedTimelineCamera } from './layers/camera/camera.ts';
import { timelineSourceToScene } from './layer-transform.ts';
import type { TimelineLayerGeometry, TimelinePoint } from './layer-transform.ts';
import type { TimelineAffine } from './affine.ts';
export { transformTimelinePoint, multiplyTimelineAffine, invertTimelineAffine } from './affine.ts';
export type { TimelineAffine } from './affine.ts';

export type TimelineBounds = { left: number; bottom: number; right: number; top: number };
export const TIMELINE_FRAME: TimelineBounds = { left: -1, bottom: -1, right: 1, top: 1 };
export const TIMELINE_IDENTITY: TimelineAffine = [1, 0, 0, 1, 0, 0];

export function timelineGeometryMatrix(geometry: TimelineLayerGeometry): TimelineAffine {
	// 原点と2つの基底を既存の2D変換へ通す。fitや回転の縦横比補正を別実装にせず、
	// プレビューのアンカーポイントとGPUの逆写像が同じ規則になるようにする。
	const origin = timelineSourceToScene([0, 0], geometry);
	const x = timelineSourceToScene([1, 0], geometry);
	const y = timelineSourceToScene([0, 1], geometry);
	return [x[0] - origin[0], x[1] - origin[1], y[0] - origin[0], y[1] - origin[1], ...origin];
}
export function transformTimelineBounds(bounds: TimelineBounds, matrix: TimelineAffine): TimelineBounds {
	const points = [[bounds.left, bounds.bottom], [bounds.right, bounds.bottom], [bounds.right, bounds.top], [bounds.left, bounds.top]].map(point => transformTimelinePoint(matrix, point as TimelinePoint));
	return { left: Math.min(...points.map(point => point[0])), right: Math.max(...points.map(point => point[0])), bottom: Math.min(...points.map(point => point[1])), top: Math.max(...points.map(point => point[1])) };
}
export function unionTimelineBounds(a: TimelineBounds, b: TimelineBounds): TimelineBounds {
	return { left: Math.min(a.left, b.left), bottom: Math.min(a.bottom, b.bottom), right: Math.max(a.right, b.right), top: Math.max(a.top, b.top) };
}
export function intersectTimelineBounds(a: TimelineBounds, b: TimelineBounds): TimelineBounds | null {
	const result = { left: Math.max(a.left, b.left), bottom: Math.max(a.bottom, b.bottom), right: Math.min(a.right, b.right), top: Math.min(a.top, b.top) };
	return result.left < result.right && result.bottom < result.top ? result : null;
}
export type TimelineRenderSpace = {
	parent: TimelineAffine;
	/** On screenにもTransformのXY移動は反映する。カメラ・Groupの変形とは分けて蓄積する。 */
	screenParent?: TimelineAffine;
	depth: number;
	/** 平面化境界ではcameraを外し、その内側のZを使わない。 */
	camera?: EvaluatedTimelineCamera | null;
	/** 出力が確定する画面。平面化の内部では省略して画面外を保持する。 */
	viewport?: TimelineBounds;
};
export function projectTimelineMatrix(matrix: TimelineAffine, depth: number, camera?: EvaluatedTimelineCamera | null): TimelineAffine | null {
	if (!camera) return matrix;
	const distance = camera.z - depth;
	if (distance < CAMERA_NEAR_DISTANCE) return null;
	// 縦の半画角と距離から、画面の半高を1とした倍率を求める。平面を傾けないため
	// 平面内の全点で距離が等しく、透視投影も1枚につき1つの2D変換として扱える。
	const scale = 1 / (Math.tan(camera.fieldOfView * Math.PI / 360) * distance);
	return multiplyTimelineAffine([scale, 0, 0, scale, -camera.position[0] * scale, -camera.position[1] * scale], matrix);
}
