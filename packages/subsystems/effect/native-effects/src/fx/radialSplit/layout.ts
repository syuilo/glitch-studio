import type { Resolution } from '@gs/shared/resolution.ts';

type PixelPoint = readonly [number, number];
type BoundaryPlane = readonly [number, number, number];

export type RadialSplitRegion = {
	startPlane: BoundaryPlane;
	endPlane: BoundaryPlane;
	bounds: { center: PixelPoint; resolution: Resolution } | null;
};

function clipPolygon(polygon: PixelPoint[], plane: BoundaryPlane): PixelPoint[] {
	if (polygon.length === 0) return [];
	const clipped: PixelPoint[] = [];
	let previous = polygon[polygon.length - 1];
	let previousDistance = previous[0] * plane[0] + previous[1] * plane[1] - plane[2];
	for (const current of polygon) {
		const currentDistance = current[0] * plane[0] + current[1] * plane[1] - plane[2];
		if ((previousDistance >= 0) !== (currentDistance >= 0)) {
			const fraction = previousDistance / (previousDistance - currentDistance);
			clipped.push([previous[0] + (current[0] - previous[0]) * fraction, previous[1] + (current[1] - previous[1]) * fraction]);
		}
		if (currentDistance >= 0) clipped.push(current);
		previous = current;
		previousDistance = currentDistance;
	}
	return clipped;
}

/** 中央原点・+Yが上のピクセル座標で、Gapを引いた後に画面へ残る領域を計算する。 */
export function calculateRadialSplitRegions(options: {
	resolution: Resolution;
	inputCount: number;
	centerInPixels: PixelPoint;
	startAngle: number;
	direction: 'clockwise' | 'counterclockwise';
	gapInPixels: number;
}): RadialSplitRegion[] {
	const { resolution, inputCount, centerInPixels, direction } = options;
	if (inputCount === 0) return [];
	if (inputCount === 1) {
		return [{ startPlane: [0, 0, 0], endPlane: [0, 0, 0], bounds: { center: [0, 0], resolution: { width: resolution.width, height: resolution.height } } }];
	}
	const halfWidth = resolution.width / 2;
	const halfHeight = resolution.height / 2;
	const canvas: PixelPoint[] = [[-halfWidth, -halfHeight], [halfWidth, -halfHeight], [halfWidth, halfHeight], [-halfWidth, halfHeight]];
	const sign = direction === 'clockwise' ? 1 : -1;
	const startAngle = options.startAngle % 1;
	const halfGap = Math.max(0, options.gapInPixels) / 2;
	const boundary = (angle: number, inwardSign: number): BoundaryPlane => {
		// 上向きが0、時計回りが正。長方形の画面でも角度とGapの幅を保つ単位法線を使う。
		const normalX = Math.cos(angle) * inwardSign;
		const normalY = -Math.sin(angle) * inwardSign;
		return [normalX, normalY, normalX * centerInPixels[0] + normalY * centerInPixels[1] + halfGap];
	};
	return Array.from({ length: inputCount }, (_, index) => {
		const startPlane = boundary((startAngle + sign * index / inputCount) * 2 * Math.PI, sign);
		const endPlane = boundary((startAngle + sign * (index + 1) / inputCount) * 2 * Math.PI, -sign);
		// 2入力以上なら各扇形は半周以下なので、内向きの2半平面の交差で表せる。
		// 境界をGap/2ずつ内側へ移し、その後で画面と交差させることで、中心の空きや
		// 画面外の中心も同じ幾何で扱い、画像を配置する矩形を残った領域から求める。
		const polygon = clipPolygon(clipPolygon(canvas, startPlane), endPlane);
		if (polygon.length < 3) return { startPlane, endPlane, bounds: null };
		const left = Math.min(...polygon.map(point => point[0]));
		const right = Math.max(...polygon.map(point => point[0]));
		const bottom = Math.min(...polygon.map(point => point[1]));
		const top = Math.max(...polygon.map(point => point[1]));
		const width = right - left;
		const height = top - bottom;
		return {
			startPlane,
			endPlane,
			bounds: width > 0 && height > 0 ? { center: [(left + right) / 2, (bottom + top) / 2], resolution: { width, height } } : null,
		};
	});
}
