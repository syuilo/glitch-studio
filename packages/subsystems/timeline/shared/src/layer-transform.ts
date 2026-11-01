import { inputUvScale } from '@gs/shared/gpu/input-fit.ts';
import { getSpatialHalfExtent, normalizedToSpatialCoordinates, spatialToNormalizedCoordinates } from '@gs/shared/spatial-coordinate.ts';
import { transformTimelinePoint, invertTimelineAffine } from './affine.ts';
import type { TimelineAffine } from './affine.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { FitMode } from '@gs/shared/types.ts';

export type TimelinePoint = [number, number];

export type TimelineLayerTransform = {
	position: TimelinePoint;
	origin: TimelinePoint;
	scale: TimelinePoint;
	/** 時計回りを正とするturn単位。複数周の値も保持する。 */
	rotation: number;
	fitMode: FitMode;
};

/** 合成前の出力全体の寸法。定数出力にはSceneと同じ仮想寸法を与える。 */
export type TimelineLayerGeometry = {
	sourceSize: Resolution;
	sceneSize: Resolution;
	transform: TimelineLayerTransform;
	/** 画像参照用の各軸[-1,+1]間の行列。公開する位置・原点は共通等方単位。 */
	matrix?: TimelineAffine;
};

/** 素材の等方単位から、配置先Sceneの等方単位へ写す倍率。 */
export function getTimelineFittedScale(sourceSize: Resolution, sceneSize: Resolution, fitMode: FitMode): TimelinePoint {
	const uvScale = inputUvScale(sourceSize, sceneSize, fitMode);
	const source = getSpatialHalfExtent(sourceSize);
	const scene = getSpatialHalfExtent(sceneSize);
	return [scene[0] / (source[0] * uvScale[0]), scene[1] / (source[1] * uvScale[1])];
}

/** 公開するベクトルは既に等方的なので、回転に縦横比補正は不要。 */
export function rotateTimelineVector(vector: TimelinePoint, rotation: number): TimelinePoint {
	const angle = rotation * (2 * Math.PI);
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	return [c * vector[0] + s * vector[1], -s * vector[0] + c * vector[1]];
}

/**
 * GPU合成・クリップ範囲は内部の各軸[-1,+1]で維持する。
 * Positionは配置先、Originは透明余白を含む素材自身の長辺単位として一度だけ換算する。
 * これは画像配置の既存Fitの換算であり、SDFやベクトル場のFit補正は追加しない。
 */
export function timelineNormalizedGeometryMatrix(geometry: TimelineLayerGeometry): TimelineAffine {
	if (geometry.matrix != null) return geometry.matrix;
	const { transform, sceneSize, sourceSize } = geometry;
	const uvScale = inputUvScale(sourceSize, sceneSize, transform.fitMode);
	const halfExtent = getSpatialHalfExtent(sceneSize);
	const origin = spatialToNormalizedCoordinates(transform.origin, sourceSize);
	const position = spatialToNormalizedCoordinates(transform.position, sceneSize);
	const angle = transform.rotation * 2 * Math.PI;
	const cosine = Math.cos(angle);
	const sine = Math.sin(angle);
	const xScale = transform.scale[0] / uvScale[0];
	const yScale = transform.scale[1] / uvScale[1];
	const matrix: TimelineAffine = [cosine * xScale, -sine * xScale * halfExtent[0] / halfExtent[1],
		sine * yScale * halfExtent[1] / halfExtent[0], cosine * yScale, 0, 0];
	matrix[4] = position[0] - matrix[0] * origin[0] - matrix[2] * origin[1];
	matrix[5] = position[1] - matrix[1] * origin[0] - matrix[3] * origin[1];
	return matrix;
}

/** 共通等方単位の素材内位置を、Scene内位置へ写す。 */
export function timelineSourceToScene(point: TimelinePoint, geometry: TimelineLayerGeometry): TimelinePoint {
	return normalizedToSpatialCoordinates(transformTimelinePoint(timelineNormalizedGeometryMatrix(geometry), spatialToNormalizedCoordinates(point, geometry.sourceSize)), geometry.sceneSize);
}

/** グループの変形を逆に辿り、親画面上のポインターを子が編集する座標へ戻す。 */
export function timelineSceneToSource(point: TimelinePoint, geometry: TimelineLayerGeometry): TimelinePoint | null {
	const inverse = invertTimelineAffine(timelineNormalizedGeometryMatrix(geometry));
	return inverse == null ? null : normalizedToSpatialCoordinates(transformTimelinePoint(inverse, spatialToNormalizedCoordinates(point, geometry.sceneSize)), geometry.sourceSize);
}

export function getTimelineLayerCorners(geometry: TimelineLayerGeometry): TimelinePoint[] {
	const matrix = timelineNormalizedGeometryMatrix(geometry);
	// 角は素材の画像参照座標で既知なので、素材側の共通単位への往復変換を省く。
	return ([[-1, 1], [1, 1], [1, -1], [-1, -1]] as TimelinePoint[])
		.map(point => normalizedToSpatialCoordinates(transformTimelinePoint(matrix, point), geometry.sceneSize));
}
