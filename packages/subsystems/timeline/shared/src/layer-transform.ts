import { inputUvScale } from '@gs/shared/gpu/input-fit.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { FitMode } from '@gs/shared/types.ts';

export type TimelinePoint = [number, number];

export type TimelineLayerTransform = {
	position: TimelinePoint;
	origin: TimelinePoint;
	scale: TimelinePoint;
	rotation: number;
	fitMode: FitMode;
};

/** 合成前の出力全体の寸法。定数出力にはSceneと同じ仮想寸法を与える。 */
export type TimelineLayerGeometry = {
	sourceSize: Resolution;
	sceneSize: Resolution;
	transform: TimelineLayerTransform;
};

export function getTimelineFittedExtent(sourceSize: Resolution, sceneSize: Resolution, fitMode: FitMode): TimelinePoint {
	const uvScale = inputUvScale(sourceSize, sceneSize, fitMode);
	return [1 / uvScale[0], 1 / uvScale[1]];
}

/** 中央原点・上向きYのScene座標。回転する距離だけを画素の縦横比へ揃える。 */
export function rotateTimelineVector(vector: TimelinePoint, rotation: number, sceneSize: Resolution): TimelinePoint {
	const aspect = sceneSize.width / sceneSize.height;
	const angle = rotation * Math.PI;
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	return [c * vector[0] + s * vector[1] / aspect, -s * vector[0] * aspect + c * vector[1]];
}

/** timeline-compositor.wgslの逆写像に対応する順写像。透明な余白も素材枠に含める。 */
export function timelineSourceToScene(point: TimelinePoint, geometry: TimelineLayerGeometry): TimelinePoint {
	const { transform, sceneSize, sourceSize } = geometry;
	const extent = getTimelineFittedExtent(sourceSize, sceneSize, transform.fitMode);
	const rotated = rotateTimelineVector([
		(point[0] - transform.origin[0]) * extent[0] * transform.scale[0],
		(point[1] - transform.origin[1]) * extent[1] * transform.scale[1],
	], transform.rotation, sceneSize);
	return [rotated[0] + transform.position[0], rotated[1] + transform.position[1]];
}

export function getTimelineLayerCorners(geometry: TimelineLayerGeometry): TimelinePoint[] {
	return ([[-1, 1], [1, 1], [1, -1], [-1, -1]] as TimelinePoint[]).map(point => timelineSourceToScene(point, geometry));
}
