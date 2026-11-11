import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EffectRenderTileController } from '../src/effect-render-tile-controller.ts';

const hint = (workPerPixel = 1, key = 'same input') => ({ workPerPixel, key });

// 【初回は小さく実行し、速い結果が続いたときだけ段階的に拡大する】
// 最初の無分割描画によるHUNGを避け、単発の速いタイルから過大な面積を推定しない。
test('starts conservatively and grows only after consecutive fast samples', () => {
	const controller = new EffectRenderTileController();
	const plan = controller.beginPass(0, [], 1024, 1024, hint());
	assert.equal(plan.maximumTilePixels, 4096);
	for (let index = 0; index < 3; index++) plan.observe(4096, 1);
	assert.equal(plan.maximumTilePixels, 4096);
	plan.observe(4096, 1);
	assert.equal(plan.maximumTilePixels, 4096, 'do not enlarge unobserved regions in the same pass');
	plan.finish();
	assert.equal(plan.maximumTilePixels, 8192);
	plan.observe(8192, 64);
	assert.equal(plan.maximumTilePixels, 2048);
});

// 【同じ条件での計算量増加を、最初のタイルを送信する前に反映する】
// 前回の軽い反復数で学習した面積を、そのまま高反復のフレームへ使わない。
// 条件・pipeline・描画寸法が変わった場合も、別の処理の学習を流用しない。
test('scales down before workload increases and resets incompatible measurements', () => {
	const controller = new EffectRenderTileController();
	const pipeline = {};
	const plan = controller.beginPass(0, [pipeline], 1024, 1024, hint(10));
	for (let index = 0; index < 4; index++) plan.observe(4096, 1);
	plan.finish();
	assert.equal(controller.beginPass(0, [pipeline], 1024, 1024, hint(80)).maximumTilePixels, 1024);
	assert.equal(controller.beginPass(0, [pipeline], 1024, 1024, hint(10)).maximumTilePixels, 1024);
	assert.equal(controller.beginPass(0, [pipeline], 1024, 1024, hint(10, 'new view')).maximumTilePixels, 4096);
	assert.equal(controller.beginPass(0, [{}], 1024, 1024, hint()).maximumTilePixels, 4096);
	assert.equal(controller.beginPass(0, [pipeline], 16, 9, hint()).maximumTilePixels, 144);
});

// 【入力を比較できない処理は描画ごとに小さいタイルから確認する】
// カスタムシェーダーや動画入力の前フレームだけが軽かった場合にも、初回の安全策を残す。
test('does not reuse a large initial tile without a workload hint', () => {
	const controller = new EffectRenderTileController();
	const plan = controller.beginPass(0, [], 1024, 1024, null);
	for (let index = 0; index < 4; index++) plan.observe(4096, 1);
	plan.finish();
	assert.equal(plan.maximumTilePixels, 8192);
	assert.equal(controller.beginPass(0, [], 1024, 1024, null).maximumTilePixels, 4096);
});

// 【同じパスの途中で面積上限を変更しても、全画素を一度だけ描画する】
// 完了済み領域の再描画や隙間は、透明度・履歴・複数出力の結果を変えてしまう。
test('covers odd and narrow targets once while adapting within a pass', () => {
	for (const [width, height] of [[257, 129], [1, 129], [129, 1]]) {
		const controller = new EffectRenderTileController();
		const plan = controller.beginPass(0, [], width, height, hint());
		const coverage = new Uint8Array(width * height);
		let lastTiles = 0;
		let index = 0;
		for (const { tile, last } of plan.tiles()) {
			assert.ok(tile.width * tile.height <= plan.maximumTilePixels);
			for (let y = tile.y; y < tile.y + tile.height; y++) for (let x = tile.x; x < tile.x + tile.width; x++) coverage[y * width + x]++;
			if (last) lastTiles++;
			plan.observe(tile.width * tile.height, index++ === 0 ? 64 : 1);
		}
		assert.ok(coverage.every(count => count === 1));
		assert.equal(lastTiles, 1);
	}
});

// 【面積を減らしても短くならない待機時間で、1画素まで縮小し続けない】
// Workerやブラウザーの通知遅延をGPU処理量と誤認すると、分割の固定費だけが増え続ける。
test('limits repeated subdivision when completion latency does not scale with area', () => {
	const plan = new EffectRenderTileController().beginPass(0, [], 1024, 1024, hint());
	plan.observe(4096, 64);
	assert.equal(plan.maximumTilePixels, 1024);
	for (let index = 0; index < 5; index++) plan.observe(1024, 64);
	assert.equal(plan.maximumTilePixels, 1024);
	plan.observe(1024, 256);
	assert.ok(plan.maximumTilePixels < 1024);
});
