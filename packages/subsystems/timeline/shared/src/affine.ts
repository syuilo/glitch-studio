/** [a,b,c,d,tx,ty]。Sceneの正規化座標上で扱い、回転の縦横比補正は変形生成時に行う。 */
export type TimelineAffine = [number, number, number, number, number, number];
export function transformTimelinePoint(matrix: TimelineAffine, point: [number, number]): [number, number] {
	return [matrix[0] * point[0] + matrix[2] * point[1] + matrix[4], matrix[1] * point[0] + matrix[3] * point[1] + matrix[5]];
}
export function multiplyTimelineAffine(parent: TimelineAffine, child: TimelineAffine): TimelineAffine {
	return [parent[0] * child[0] + parent[2] * child[1], parent[1] * child[0] + parent[3] * child[1],
									parent[0] * child[2] + parent[2] * child[3], parent[1] * child[2] + parent[3] * child[3],
									parent[0] * child[4] + parent[2] * child[5] + parent[4], parent[1] * child[4] + parent[3] * child[5] + parent[5]];
}
export function invertTimelineAffine(matrix: TimelineAffine): TimelineAffine | null {
	const [a, b, c, d, x, y] = matrix;
	const determinant = a * d - b * c;
	if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
	return [d / determinant, -b / determinant, -c / determinant, a / determinant, (c * y - d * x) / determinant, (b * x - a * y) / determinant];
}
