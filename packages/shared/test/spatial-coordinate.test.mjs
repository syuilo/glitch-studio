import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSpatialHalfExtent, normalizedToSpatialCoordinates, spatialToNormalizedCoordinates } from '../src/spatial-coordinate.ts';

// 【長辺全体を1とし、縦横で同じ距離を使う】
// 画面端を各軸±1とする内部座標が、公開パラメータへ漏れる退行を防ぐ。
// 解像度を変えても同じ比率なら値を変えず、縦横を入れ替えると端の範囲だけが入れ替わる。
test('uses one isotropic long-side unit at every aspect ratio and resolution', () => {
	for (const [width, height, expected] of [[200, 100, [0.5, 0.25]], [100, 200, [0.25, 0.5]], [100, 100, [0.5, 0.5]]]) {
		const resolution = { width, height };
		assert.deepEqual(getSpatialHalfExtent(resolution), expected);
		assert.deepEqual(normalizedToSpatialCoordinates([1, 1], resolution), expected);
		assert.deepEqual(getSpatialHalfExtent({ width: width * 3, height: height * 3 }), expected);
		assert.deepEqual(spatialToNormalizedCoordinates([0.1, 0.1], resolution).map((value, axis) => value * [width, height][axis] / 2), [Math.max(width, height) / 10, Math.max(width, height) / 10]);
	}
});

// 【位置の差を移動ベクトルとしてそのまま利用できる】
// 原点・画面外も含めて往復し、位置だけへ余分な平行移動や倍率が入らないことを保証する。
test('converts positions and displacement vectors with the same linear scale', () => {
	const resolution = { width: 1600, height: 900 };
	const start = [-0.25, 0.125];
	const end = [0.75, -0.125];
	const difference = end.map((value, axis) => value - start[axis]);
	const normalizedStart = spatialToNormalizedCoordinates(start, resolution);
	const normalizedEnd = spatialToNormalizedCoordinates(end, resolution);
	assert.deepEqual(normalizedToSpatialCoordinates(normalizedEnd, resolution), end);
	assert.deepEqual(spatialToNormalizedCoordinates(difference, resolution), normalizedEnd.map((value, axis) => value - normalizedStart[axis]));
	assert.deepEqual(normalizedToSpatialCoordinates([0, 0], resolution), [0, 0]);
});
