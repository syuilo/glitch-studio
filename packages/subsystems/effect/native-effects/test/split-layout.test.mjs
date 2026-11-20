import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateSplitLayout } from '../src/fx/splitLayout/layout.ts';

function near(actual, expected, tolerance = 1e-12) {
	assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

function regionNear(actual, center, halfSize) {
	assert.ok(actual != null);
	for (let axis = 0; axis < 2; axis++) {
		near(actual.center[axis], center[axis]);
		near(actual.halfSize[axis], halfSize[axis]);
	}
}

// 【左右・上下の分割では、OffsetとGapから既知の矩形の中心へ配置する】
// 任意角の計算を導入しても、基本的な二分割で位置・寸法・A/Bの順序を変えない。
// Offsetは長辺全体=1で、Angleは0が上、0.25が右であることも固定する。
test('places axis-aligned regions using signed offsets and full gap widths', () => {
	const horizontal = calculateSplitLayout([0.5, 0.25], 0.25, 0.1, 0.04);
	assert.deepEqual(horizontal.normal, [1, 0]);
	regionNear(horizontal.regionA, [-0.21, 0], [0.29, 0.25]);
	regionNear(horizontal.regionB, [0.31, 0], [0.19, 0.25]);
	const vertical = calculateSplitLayout([0.5, 0.25], 0, 0, 0);
	regionNear(vertical.regionA, [0, -0.125], [0.5, 0.125]);
	regionNear(vertical.regionB, [0, 0.125], [0.5, 0.125]);
});

// 【対角線で二分した三角形の面積重心を画像中心にする】
// 外接矩形の中心は分割線上に来てしまい、入力の中心が切り落とされる。
// 重心へ動かした後もCoverで角まで埋められる、対称な配置枠の寸法も確認する。
test('centers diagonal triangles on their area centroids with covering frames', () => {
	const layout = calculateSplitLayout([0.5, 0.5], 0.125, 0, 0);
	regionNear(layout.regionA, [-1 / 6, -1 / 6], [2 / 3, 2 / 3]);
	regionNear(layout.regionB, [1 / 6, 1 / 6], [2 / 3, 2 / 3]);
	const wide = calculateSplitLayout([0.5, 0.25], Math.atan2(0.25, 0.5) / (2 * Math.PI), 0, 0);
	regionNear(wide.regionA, [-1 / 6, -1 / 12], [2 / 3, 1 / 3]);
	regionNear(wide.regionB, [1 / 6, 1 / 12], [2 / 3, 1 / 3]);
});

// 【不等分の五角形と三角形でも、頂点平均ではなく面積で重み付けする】
// 頂点数や辺との交点位置で配置が不自然に偏らないよう、既知の切り欠き面積から照合する。
test('uses area-weighted centroids for unequal polygonal regions', () => {
	const layout = calculateSplitLayout([0.5, 0.5], 0.125, 0.5 / Math.SQRT2, 0);
	regionNear(layout.regionA, [-1 / 21, -1 / 21], [0.5 + 1 / 21, 0.5 + 1 / 21]);
	regionNear(layout.regionB, [1 / 3, 1 / 3], [1 / 3, 1 / 3]);
});

// 【画面外の領域・大きなGap・負のGapを一貫して扱う】
// トランジション用の端点補正を持ち込まず、両領域が消える配置は透明のままにする。
test('keeps empty regions empty without transition endpoint corrections', () => {
	const onlyA = calculateSplitLayout([0.5, 0.25], 0.125, 1, 0.1);
	regionNear(onlyA.regionA, [0, 0], [0.5, 0.25]);
	assert.equal(onlyA.regionB, null);
	const onlyB = calculateSplitLayout([0.5, 0.25], 0.125, -1, 0.1);
	assert.equal(onlyB.regionA, null);
	regionNear(onlyB.regionB, [0, 0], [0.5, 0.25]);
	const empty = calculateSplitLayout([0.5, 0.25], 0.125, 0, 2);
	assert.equal(empty.regionA, null);
	assert.equal(empty.regionB, null);
	assert.deepEqual(calculateSplitLayout([0.5, 0.25], 0.25, 0, -1), calculateSplitLayout([0.5, 0.25], 0.25, 0, 0));
});

// 【角に残る小さな三角形を桁落ちで消さず、安定した重心を返す】
// 面積の固定閾値や全画面の座標での差し引きでは、低解像度の境界付近が突然消える。
test('preserves small corner triangles without an arbitrary area cutoff', () => {
	const side = 1e-7;
	const layout = calculateSplitLayout([0.5, 0.5], 0.125, (-1 + side) / Math.SQRT2, 0);
	assert.ok(layout.regionA != null);
	for (let axis = 0; axis < 2; axis++) {
		near(layout.regionA.center[axis], -0.5 + side / 3, 1e-15);
		near(layout.regionA.halfSize[axis], side * 2 / 3, 1e-15);
	}
});

// 【縦横比・角度・Offset・Gapを変えても、重心を自身の領域内に保つ】
// 半回転とOffsetの符号反転でA/Bが入れ替わることも、画像を鏡像化しない配置規則として確認する。
test('keeps centroids within their regions across aspect ratios and rotations', () => {
	for (const halfExtent of [[0.5, 0.5], [0.5, 0.28125], [0.25, 0.5]]) {
		for (const angle of [-0.1, 0, 0.125, 123 / 360, 0.75, 1.1]) {
			for (const offset of [-0.4, -0.18, 0, 0.25]) {
				for (const gap of [0, 0.02, 0.5]) {
					const layout = calculateSplitLayout(halfExtent, angle, offset, gap);
					const reversed = calculateSplitLayout(halfExtent, angle + 0.5, -offset, gap);
					for (const [region, other, sign] of [[layout.regionA, reversed.regionB, 1], [layout.regionB, reversed.regionA, -1]]) {
						if (region == null) { assert.equal(other, null); continue; }
						regionNear(other, region.center, region.halfSize);
						const distance = region.center[0] * layout.normal[0] + region.center[1] * layout.normal[1] - offset;
						assert.ok(sign * distance <= -gap / 2 + 1e-12);
						for (let axis = 0; axis < 2; axis++) {
							assert.ok(Math.abs(region.center[axis]) <= halfExtent[axis] + 1e-12);
							assert.ok(region.halfSize[axis] > 0);
						}
					}
				}
			}
		}
	}
});
