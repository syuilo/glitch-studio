import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
	entryPoints: [fileURLToPath(new URL('../src/utility/preview-rulers.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false,
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { getPreviewRulerTicks } = module.exports;
const coordinate = (ticks, value) => ticks.find(tick => tick.coordinate === value);
const interval = ticks => ticks[1].coordinate - ticks[0].coordinate;

// 【共通座標は中央原点で、縦横比によらず両軸に同じ単位を使う】
// 各軸を個別に正規化すると、横長画像のY端が±0.5になり位置パラメータと一致しなくなる。
// 正方形・横長・縦長の画像端と、画面では下向きになるY軸の符号を確認する。
test('uses centered isotropic coordinates with positive Y pointing upwards', () => {
	for (const [width, height] of [[800, 800], [800, 400], [400, 800]]) {
		const ticks = getPreviewRulerTicks({ left: 0, top: 0, width, height }, { width, height });
		const longSide = Math.max(width, height);
		assert.equal(coordinate(ticks.x, -width / longSide / 2).position, 0);
		assert.equal(coordinate(ticks.x, width / longSide / 2).position, width);
		assert.equal(coordinate(ticks.y, height / longSide / 2).position, 0);
		assert.equal(coordinate(ticks.y, -height / longSide / 2).position, height);
		assert.equal(coordinate(ticks.x, 0).position, width / 2);
		assert.equal(coordinate(ticks.y, 0).position, height / 2);
		assert.equal(interval(ticks.x), interval(ticks.y));
	}
});

// 【目盛りは1、0.5、0.25…と半分ずつ細かくする】
// 10進の自動目盛りや固定間隔に戻ると、指定した刻みにならず拡大時の精度も上がらない。
// 縮小時の2、4…への拡張も同じ規則で扱う。
test('halves the coordinate interval as the preview is enlarged', () => {
	for (const [longSide, expectedInterval] of [[25, 4], [50, 2], [100, 1], [200, 0.5], [400, 0.25], [800, 0.125], [1600, 0.0625]]) {
		const ticks = getPreviewRulerTicks({ left: 400 - longSide / 2, top: 200 - longSide / 4, width: longSide, height: longSide / 2 }, { width: 800, height: 400 });
		assert.equal(interval(ticks.x), expectedInterval);
		assert.equal(interval(ticks.y), expectedInterval);
	}
});

// 【パン後は画像外にも目盛りを延長し、可視範囲だけを生成する】
// 原点が表示領域の外へ移動してもルーラーを読めるようにし、大きな拡大画像全体の目盛りは作らない。
test('tracks panning and generates only visible ticks including positions outside the image', () => {
	const ticks = getPreviewRulerTicks({ left: 100, top: -300, width: 200, height: 100 }, { width: 800, height: 400 });
	assert.equal(coordinate(ticks.x, 0).position, 200);
	assert.equal(coordinate(ticks.x, 1).position, 400);
	assert.equal(coordinate(ticks.y, -2).position, 150);
	assert.equal(coordinate(ticks.y, 0), undefined);
	for (const [axis, size] of [[ticks.x, 800], [ticks.y, 400]]) {
		assert.ok(axis.length <= size / 64 + 1);
		assert.ok(axis.every(tick => tick.position >= 0 && tick.position <= size));
	}
});

// 【画面上の寸法が同じなら、目盛りはレンダリング解像度やDPRで変わらない】
// 物理ピクセルや元画像の解像度から間隔を求めると、表示先の切替でラベル密度が変わってしまう。
// 計算の入力はCSS pxの実寸だけとし、表示位置の平行移動でも密度を保つ。
test('keeps intervals and label density stable when the viewport is translated', () => {
	const canvasRect = { left: -500, top: -200, width: 1600, height: 800 };
	const viewportSize = { width: 800, height: 400 };
	const before = getPreviewRulerTicks(canvasRect, viewportSize);
	const after = getPreviewRulerTicks({ ...canvasRect, left: canvasRect.left + 20, top: canvasRect.top + 30 }, viewportSize);
	assert.equal(interval(before.x), interval(after.x));
	assert.equal(coordinate(after.x, 0).position - coordinate(before.x, 0).position, 20);
	assert.equal(coordinate(after.y, 0).position - coordinate(before.y, 0).position, 30);
});

// 【拡大時の長い小数ラベルも丸めず、重ならない間隔を確保する】
// 半分刻みでは0.0009765625のような値が現れる。表示を短く丸めると線の位置と数値が一致しない。
test('preserves exact fractional labels and leaves room for them at high zoom', () => {
	const ticks = getPreviewRulerTicks({ left: -1500000, top: -750000, width: 3000000, height: 1500000 }, { width: 1000, height: 500 });
	for (const axis of [ticks.x, ticks.y]) {
		for (let index = 0; index < axis.length; index++) {
			assert.equal(Number(axis[index].label), axis[index].coordinate);
			if (index === 0) continue;
			const spacing = Math.abs(axis[index].position - axis[index - 1].position);
			assert.ok(spacing >= Math.max(axis[index].label.length, axis[index - 1].label.length) * 7 + 16);
		}
	}
	assert.ok(Number.isInteger(Math.log2(interval(ticks.x))));
});

// 【非表示や初期化中の寸法0では目盛りを生成しない】
// パネルの一時的な非表示やCanvas未初期化を通常の状態として扱い、0除算や不正な配列長を防ぐ。
test('returns no ticks until both the canvas and viewport have positive dimensions', () => {
	for (const [width, height, viewportWidth, viewportHeight] of [[0, 400, 800, 400], [800, 0, 800, 400], [800, 400, 0, 400], [800, 400, 800, 0]]) {
		assert.deepEqual(getPreviewRulerTicks({ left: 0, top: 0, width, height }, { width: viewportWidth, height: viewportHeight }), { x: [], y: [] });
	}
});
