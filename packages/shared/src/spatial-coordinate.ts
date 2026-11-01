import type { Resolution } from './resolution.ts';

/**
 * 公開する位置・変位・距離は、描画領域の長辺全体を1とする等方座標で扱う。
 * GPUの全画面頂点や画像参照の各軸[-1,+1]は内部座標としてのみ使い、境界で換算する。
 * Size Referenceや入力接続のFitによって、このデータの単位自体は変更しない。
 */
export function getSpatialHalfExtent(resolution: Resolution): [number, number] {
	const diameter = 2 * Math.max(resolution.width, resolution.height);
	return [resolution.width / diameter, resolution.height / diameter];
}

export function normalizedToSpatialCoordinates(point: readonly [number, number], resolution: Resolution): [number, number] {
	const halfExtent = getSpatialHalfExtent(resolution);
	return [point[0] * halfExtent[0], point[1] * halfExtent[1]];
}

export function spatialToNormalizedCoordinates(point: readonly [number, number], resolution: Resolution): [number, number] {
	const halfExtent = getSpatialHalfExtent(resolution);
	return [point[0] / halfExtent[0], point[1] / halfExtent[1]];
}
