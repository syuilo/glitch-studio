import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/fx/radialSplit/layout.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { calculateRadialSplitRegions } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const defaults = { resolution: { width: 16, height: 8 }, inputCount: 4, centerInPixels: [0, 0], startAngle: 0, direction: 'clockwise', gapInPixels: 0 };
const regions = overrides => calculateRadialSplitRegions({ ...defaults, ...overrides });

function compareBounds(actual, expected) {
	assert.ok(actual != null);
	const values = [...actual.center, actual.resolution.width, actual.resolution.height];
	values.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9, `${values} != ${expected}`));
}

// 【Gapを引いた後の領域に画像を配置する】
// Gapを増やした際に外接矩形の中心と寸法が両方変わることを確認し、Gap前の配置へ戻る回帰を防ぐ。
test('bounds each sector after removing half the gap from both boundaries', () => {
	const original = regions({});
	[[4, 2, 8, 4], [4, -2, 8, 4], [-4, -2, 8, 4], [-4, 2, 8, 4]].forEach((expected, index) => compareBounds(original[index].bounds, expected));
	const gapped = regions({ gapInPixels: 2 });
	[[4.5, 2.5, 7, 3], [4.5, -2.5, 7, 3], [-4.5, -2.5, 7, 3], [-4.5, 2.5, 7, 3]].forEach((expected, index) => compareBounds(gapped[index].bounds, expected));
});

// 【斜めの境界にも同じ垂直距離でGapを適用する】
// 角度幅を差し引く実装では、半径によって隙間が広がる。3分割の既知の交点で一定幅を検証する。
test('clips oblique sector boundaries by perpendicular pixel distances', () => {
	const actual = regions({ resolution: { width: 20, height: 20 }, inputCount: 3, gapInPixels: 2 });
	const firstBottom = -8 / Math.sqrt(3);
	compareBounds(actual[0].bounds, [5.5, (10 + firstBottom) / 2, 9, 10 - firstBottom]);
	const middleTop = -2 / Math.sqrt(3);
	compareBounds(actual[1].bounds, [0, (-10 + middleTop) / 2, 20, 10 + middleTop]);
	compareBounds(actual[2].bounds, [-5.5, (10 + firstBottom) / 2, 9, 10 - firstBottom]);
});

// 【上向きの開始境界と配列順を、回転・反時計回りでも維持する】
// 画像の入力順が反転したり、開始角が扇形の中央を指したりする取り違えを防ぐ。
test('orders sectors from the upward boundary with clockwise turns', () => {
	compareBounds(regions({ startAngle: 0.25 })[0].bounds, [4, -2, 8, 4]);
	compareBounds(regions({ startAngle: 1.25 })[0].bounds, [4, -2, 8, 4]);
	compareBounds(regions({ startAngle: -0.25 })[0].bounds, [-4, 2, 8, 4]);
	compareBounds(regions({ direction: 'counterclockwise' })[0].bounds, [-4, 2, 8, 4]);
	compareBounds(regions({ centerInPixels: [2, 1] })[0].bounds, [5, 2.5, 6, 3]);
});

// 【画面外の中心と消えた領域を、残りの入力へ再配分しない】
// 交差のない扇形を削除して詰めると配列と画像の対応が変わるため、nullの位置を保持する。
test('retains empty sectors for offscreen centers and excessive gaps', () => {
	const offscreen = regions({ centerInPixels: [20, 0] });
	assert.equal(offscreen.length, 4);
	assert.equal(offscreen[0].bounds, null);
	assert.equal(offscreen[1].bounds, null);
	compareBounds(offscreen[2].bounds, [0, -2, 16, 4]);
	compareBounds(offscreen[3].bounds, [0, 2, 16, 4]);
	assert.ok(regions({ gapInPixels: 20 }).every(region => region.bounds == null));
});

// 【入力0個・1個・2個を分割数固有の境界条件として扱う】
// 1個では境界がなく、2個では2本の半直線が1本の直線になる。Gapによる二重削除を防ぐ。
test('handles empty single and half-plane layouts', () => {
	assert.deepEqual(regions({ inputCount: 0 }), []);
	compareBounds(regions({ inputCount: 1, gapInPixels: 20, centerInPixels: [50, 50] })[0].bounds, [0, 0, 16, 8]);
	const halves = regions({ inputCount: 2, gapInPixels: 2 });
	compareBounds(halves[0].bounds, [4.5, 0, 7, 8]);
	compareBounds(halves[1].bounds, [-4.5, 0, 7, 8]);
	compareBounds(regions({ gapInPixels: -2 })[0].bounds, [4, 2, 8, 4]);
});

// 【GPUTextureのようにprototype経由で寸法を持つ入力も使える】
// オブジェクトのspreadではWebGPUの読み取り専用寸法がコピーされず、1入力のFitがNaNになる。
// 構造的なResolutionとして受け取ったwidth・heightを明示的に読み出すことを確認する。
test('reads inherited texture dimensions for the single input bounds', () => {
	const resolution = Object.create({ width: 16, height: 8 });
	compareBounds(regions({ inputCount: 1, resolution })[0].bounds, [0, 0, 16, 8]);
});

// 【解像度だけを変えても配置・Gapの相対寸法を保つ】
// CPUの領域計算で画素丸めや出力の片軸だけへの倍率適用を行わないことを確認する。
test('scales clipped bounds with resolution and spatial dimensions', () => {
	const first = regions({ inputCount: 5, startAngle: 0.07, centerInPixels: [1, -0.5], gapInPixels: 0.7 });
	const doubled = regions({ resolution: { width: 32, height: 16 }, inputCount: 5, startAngle: 0.07, centerInPixels: [2, -1], gapInPixels: 1.4 });
	first.forEach((region, index) => {
		if (region.bounds == null) assert.equal(doubled[index].bounds, null);
		else compareBounds(doubled[index].bounds, [...region.bounds.center.map(value => value * 2), region.bounds.resolution.width * 2, region.bounds.resolution.height * 2]);
	});
});
