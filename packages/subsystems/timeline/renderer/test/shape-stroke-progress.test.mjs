import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const { getShapeStrokeEndpoint } = await loadSource(fileURLToPath(new URL('../src/shape-stroke-progress.ts', import.meta.url)));
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const nearPoint = (actual, expected) => actual.forEach((value, index) => near(value, expected[index]));
const ellipse = size => ({ type: 'ellipse', size });
const rectangle = (size, cornerRadius = 0) => ({ type: 'rectangle', size, cornerRadius });

// 【四分周ごとの位置は寸法や角丸に依存せず、0と1が同じ起点を表す】
// 起点と進行率は同じ弧長座標を使う。半周が常に反対側となり、回転の前の
// 形状座標に留まることを確認し、配置・合成設定の混入を防ぐ。
test('maps cardinal progress positions consistently for ellipses and rounded rectangles', () => {
	for (const shape of [ellipse([2, 1]), rectangle([2, 1]), rectangle([2, 1], 0.3), rectangle([2, 1], 0.5)]) {
		for (const [progress, point, tangent] of [
			[0, [0, 0.5], [1, 0]], [0.25, [1, 0], [0, -1]],
			[0.5, [0, -0.5], [-1, 0]], [0.75, [-1, 0], [0, 1]], [1, [0, 0.5], [1, 0]],
		]) {
			const result = getShapeStrokeEndpoint(shape, progress);
			nearPoint(result.point, point);
			nearPoint(result.tangent, tangent);
		}
	}
});

// 【長方形の直線と角丸の弧を同じ長さの単位で進む】
// 中心からの角度を進行率として使うと長辺と短辺で速さが変わる。
// 直線上・角丸上・起点をまたぐ区間それぞれの端点を既知の寸法から確認する。
test('traverses straight edges and circular corners by perimeter length', () => {
	nearPoint(getShapeStrokeEndpoint(rectangle([4, 2]), 1 / 12).point, [1, 1]);
	nearPoint(getShapeStrokeEndpoint(rectangle([4, 2]), 2.5 / 12).point, [2, 0.5]);
	const shape = rectangle([4, 2], 0.5);
	const perimeter = 8 + Math.PI;
	const corner = getShapeStrokeEndpoint(shape, (1.5 + Math.PI / 8) / perimeter);
	nearPoint(corner.point, [1.5 + Math.SQRT1_2 / 2, 0.5 + Math.SQRT1_2 / 2]);
	nearPoint(corner.tangent, [Math.SQRT1_2, -Math.SQRT1_2]);
	nearPoint(getShapeStrokeEndpoint(rectangle([4, 2]), (0.9 + 0.2) % 1).point, [1.2, 1]);
});

// 【細長い楕円でも角度の割合ではなく弧長の割合で位置を求める】
// 実装の中点積分とは別に、高密度の折れ線長で端点までの長さを測る。
// 横長・縦長・真円を含め、一定速のキー補間で不自然な加減速が出ないようにする。
test('matches independent arc lengths for eccentric ellipses', () => {
	for (const size of [[2, 1], [1, 2], [2, 0.002], [0.002, 2], [1, 1]]) {
		const [width, height] = size.map(value => value / 2);
		const measure = end => {
			let length = 0;
			let previous = [0, height];
			for (let index = 1; index <= 20000; index++) {
				const angle = end * index / 20000;
				const point = [width * Math.sin(angle), height * Math.cos(angle)];
				length += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
				previous = point;
			}
			return length;
		};
		const perimeter = measure(Math.PI / 2) * 4;
		for (const progress of [0.001, 0.02, 0.1, 0.17, 0.249]) {
			const { point, tangent } = getShapeStrokeEndpoint(ellipse(size), progress);
			const angle = Math.atan2(point[0] / width, point[1] / height);
			near(measure(angle) / perimeter, progress, 2e-6);
			near(Math.hypot(...tangent), 1);
			near(tangent[0] * point[0] / (width * width) + tangent[1] * point[1] / (height * height), 0, 1e-8);
		}
	}
});

// 【寸法0は端点計算でも有限値を保つ】
// キー補間で形状が一時的に消える場合にも、NaNをuniformやキャッシュへ持ち込まない。
test('keeps degenerate geometry finite', () => {
	for (const size of [[0, 0], [0, 1], [1, 0]]) {
		for (const type of ['ellipse', 'rectangle']) {
			const result = getShapeStrokeEndpoint({ type, size, cornerRadius: 0 }, 0.5);
			assert.ok([...result.point, ...result.tangent].every(Number.isFinite));
		}
	}
});
