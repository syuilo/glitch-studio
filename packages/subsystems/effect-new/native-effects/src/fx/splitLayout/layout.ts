type Point = readonly [number, number];

export type SplitLayoutRegion = {
	center: [number, number];
	halfSize: [number, number];
};

/** 長辺全体=1の座標で、dot(position, normal) <= boundaryの領域を矩形から切り出す。 */
function clipRectangle(halfExtent: Point, normal: Point, boundary: number): Point[] {
	const [halfWidth, halfHeight] = halfExtent;
	const corners: Point[] = [[-halfWidth, -halfHeight], [halfWidth, -halfHeight], [halfWidth, halfHeight], [-halfWidth, halfHeight]];
	const points: Point[] = [];
	for (let index = 0; index < corners.length; index++) {
		const start = corners[index];
		const end = corners[(index + 1) % corners.length];
		const startDistance = start[0] * normal[0] + start[1] * normal[1] - boundary;
		const endDistance = end[0] * normal[0] + end[1] * normal[1] - boundary;
		if (startDistance <= 0) points.push(start);
		if ((startDistance <= 0) !== (endDistance <= 0)) {
			const fraction = startDistance / (startDistance - endDistance);
			points.push([start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction]);
		}
	}
	return points;
}

function calculateRegion(points: Point[]): SplitLayoutRegion | null {
	if (points.length < 3) return null;
	const origin = points[0];
	let twiceArea = 0;
	let weightedX = 0;
	let weightedY = 0;
	// 全画面の座標のまま面積を差し引くと、角に残る小さな三角形で桁落ちする。
	// 最初の頂点を原点とする三角形へ分け、正の面積を加算して重心を求める。
	for (let index = 1; index + 1 < points.length; index++) {
		const x1 = points[index][0] - origin[0];
		const y1 = points[index][1] - origin[1];
		const x2 = points[index + 1][0] - origin[0];
		const y2 = points[index + 1][1] - origin[1];
		const cross = x1 * y2 - y1 * x2;
		twiceArea += cross;
		weightedX += (x1 + x2) * cross;
		weightedY += (y1 + y2) * cross;
	}
	if (twiceArea <= 0) return null;
	const center: [number, number] = [origin[0] + weightedX / (3 * twiceArea), origin[1] + weightedY / (3 * twiceArea)];
	const halfSize: [number, number] = [0, 0];
	// 外接矩形の中心では、斜め分割時に画像の中心が境界上へ来ることがある。
	// 面積重心を中心として全頂点を包む矩形をFitの基準にし、画像を正立させたまま
	// Coverで領域全体を埋める。単に画像を重心へ移動するだけでは端に余白ができる。
	for (const point of points) {
		halfSize[0] = Math.max(halfSize[0], Math.abs(point[0] - center[0]));
		halfSize[1] = Math.max(halfSize[1], Math.abs(point[1] - center[1]));
	}
	return { center, halfSize };
}

export function calculateSplitLayout(halfExtent: Point, angle: number, offset: number, gap: number) {
	const radians = (angle % 1) * 2 * Math.PI;
	// 真横・真上の分割を浮動小数点のsin/cosの誤差で僅かに傾けない。
	const normal = [Math.sin(radians), Math.cos(radians)].map(value => Math.abs(value) < 1e-12 ? 0 : value) as [number, number];
	const halfGap = Math.max(0, gap) / 2;
	const boundaryA = offset - halfGap;
	const boundaryB = offset + halfGap;
	return {
		normal,
		boundaryA,
		boundaryB,
		regionA: calculateRegion(clipRectangle(halfExtent, normal, boundaryA)),
		regionB: calculateRegion(clipRectangle(halfExtent, [-normal[0], -normal[1]], -boundaryB)),
	};
}
