import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EffectRenderTileController } from '../src/effect-render-tile-controller.ts';

const hint = (workPerPixel = 1, key = 'same input') => ({ workPerPixel, key });

// 【進捗用の未送信タイル数を、実際の分割と端数・細長い描画先でも一致させる】
// 面積を単純に割るだけでは64pxの寸法下限や二分の端数を反映できず、
// 最終タイルで100%にならない、または完了前に100%になる表示を招く。
test('counts remaining tiles exactly for square, odd and narrow targets', () => {
	for (const [width, height] of [[1024, 1024], [257, 129], [65, 65], [16, 16384], [1, 129], [129, 1], [16, 9]]) {
		const plan = new EffectRenderTileController().beginPass(0, [], width, height, hint());
		const totalTiles = plan.remainingTileCount;
		let completedTiles = 0;
		for (const _tile of plan.tiles()) {
			completedTiles++;
			assert.equal(plan.remainingTileCount, totalTiles - completedTiles);
		}
		assert.equal(totalTiles, completedTiles);
	}
});

// 【タイルを拡大した後に縮小しても、未送信数のキャッシュを古い値へ戻さない】
// 自動分割の総数は増減する。途中の進捗を読まない呼び出しでも、
// 現在の面積上限と未送信領域から数え直して正しい総数を返す必要がある。
test('recounts remaining tiles after growth and reduction between progress reads', () => {
	const controller = new EffectRenderTileController();
	controller.beginPass(0, [], 16, 1024, hint());
	const plan = controller.beginPass(0, [], 16, 1024, hint(65536));
	assert.equal(plan.remainingTileCount, 16);
	const tiles = plan.tiles();
	for (let index = 0; index < 4; index++) {
		const { tile } = tiles.next().value;
		plan.observe(tile.width * tile.height, 1);
	}
	const { tile } = tiles.next().value;
	assert.equal(tile.width * tile.height, 2048);
	plan.observe(tile.width * tile.height, 512);
	assert.equal(plan.remainingTileCount, 10);
	let remaining = 0;
	for (const _tile of tiles) remaining++;
	assert.equal(remaining, 10);
	assert.equal(plan.remainingTileCount, 0);
});

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
	assert.equal(plan.maximumTilePixels, 8192, 'a single delayed completion must not subdivide');
	plan.observe(8192, 64);
	plan.observe(8192, 64);
	assert.equal(plan.maximumTilePixels, 4096);
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
	assert.equal(controller.beginPass(0, [pipeline], 1024, 1024, hint(80)).maximumTilePixels, 4096);
	assert.equal(controller.beginPass(0, [pipeline], 1024, 1024, hint(10)).maximumTilePixels, 4096);
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
	for (const [width, height] of [[257, 129], [129, 129], [65, 65], [1, 129], [129, 1], [63, 257], [257, 63], [16, 9]]) {
		const controller = new EffectRenderTileController();
		const plan = controller.beginPass(0, [], width, height, hint());
		const coverage = new Uint8Array(width * height);
		let lastTiles = 0;
		let index = 0;
		for (const { tile, last } of plan.tiles()) {
			assert.ok(tile.width >= Math.min(width, 64));
			assert.ok(tile.height >= Math.min(height, 64));
			assert.ok(tile.width * tile.height <= plan.maximumTilePixels || Math.max(tile.width, tile.height) < 128,
				'only exceed the area target when a split would violate the minimum dimension');
			for (let y = tile.y; y < tile.y + tile.height; y++) for (let x = tile.x; x < tile.x + tile.width; x++) coverage[y * width + x]++;
			if (last) lastTiles++;
			plan.observe(tile.width * tile.height, index++ === 0 ? 128 : 1);
		}
		assert.ok(coverage.every(count => count === 1));
		assert.equal(lastTiles, 1);
	}
});

// 【面積を減らしても短くならない待機時間では、固定下限より手前でも縮小を止める】
// Workerやブラウザーの通知遅延をGPU処理量と誤認すると、分割の固定費だけが増え続ける。
test('limits repeated subdivision when completion latency does not scale with area', () => {
	const controller = new EffectRenderTileController();
	let plan = controller.beginPass(0, [], 1024, 1024, hint());
	for (let pass = 0; pass < 4; pass++) {
		for (let index = 0; index < 4; index++) plan.observe(plan.maximumTilePixels, 1);
		plan.finish();
		plan = controller.beginPass(0, [], 1024, 1024, hint());
	}
	assert.equal(plan.maximumTilePixels, 65536);
	for (let index = 0; index < 3; index++) plan.observe(65536, 64);
	assert.equal(plan.maximumTilePixels, 16384);
	for (let index = 0; index < 5; index++) plan.observe(16384, 64);
	assert.equal(plan.maximumTilePixels, 16384);
	plan.observe(16384, 256);
	assert.equal(plan.maximumTilePixels, 4096);
});

// 【散発的な完了通知の遅延で、一枚の描画が数百万タイルへ膨らまない】
// 実GPUでは速いタイルの間にも32ms超の通知遅延が混ざる。これを毎回GPU負荷と
// 見なすと面積が単調に減り、CPUのコマンド生成・完了待ちで描画が終わらなくなる。
test('does not collapse tiles after intermittent completion notification delays', () => {
	for (const delayedSamples of [1, 2]) {
		const controller = new EffectRenderTileController();
		let plan = controller.beginPass(0, [], 1920, 1080, hint());
		for (let pass = 0; pass < 2; pass++) {
			for (let index = 0; index < 4; index++) plan.observe(plan.maximumTilePixels, 1);
			plan.finish();
			plan = controller.beginPass(0, [], 1920, 1080, hint());
		}
		let tileCount = 0;
		for (const { tile } of plan.tiles()) {
			tileCount++;
			plan.observe(tile.width * tile.height, tileCount % 64 < delayedSamples ? 40 : 1);
			assert.equal(plan.maximumTilePixels, 16384);
		}
		assert.equal(tileCount, 128);
	}
});

// 【面積依存しない遅延の観測を、間に速いタイルが入っても保持する】
// 直前のタイルだけと比較したり速い通知で縮小の下限を消すと、遅延の波が来るたびに
// 再び細分化してしまう。実行時間が大幅に増加した場合は、この下限を解除する。
test('retains evidence of fixed completion latency across fast samples', () => {
	const controller = new EffectRenderTileController();
	let plan = controller.beginPass(0, [], 1024, 1024, hint());
	for (let pass = 0; pass < 4; pass++) {
		for (let index = 0; index < 4; index++) plan.observe(plan.maximumTilePixels, 1);
		plan.finish();
		plan = controller.beginPass(0, [], 1024, 1024, hint());
	}
	for (let index = 0; index < 3; index++) plan.observe(65536, 64);
	assert.equal(plan.maximumTilePixels, 16384);
	for (let index = 0; index < 8; index++) plan.observe(16384, 1);
	for (let index = 0; index < 3; index++) plan.observe(16384, 64);
	assert.equal(plan.maximumTilePixels, 16384);
	for (let index = 0; index < 8; index++) plan.observe(16384, 1);
	for (let index = 0; index < 3; index++) plan.observe(16384, 64);
	assert.equal(plan.maximumTilePixels, 16384);
	plan.observe(16384, 256);
	assert.equal(plan.maximumTilePixels, 4096);
});

// 【反復数変更で安全側に縮小した面積を、同じ描画内で保守的な初期上限まで戻す】
// 片辺が64px未満で初期面積より下限が小さい描画先でも、反復数変更後の細分化を維持しない。
// 通知の固定費が8msを超えていても、32msの目標に余裕が続けば回復できるようにする。
test('recovers conservative tile sizes within a pass after a large workload increase', () => {
	const controller = new EffectRenderTileController();
	const previous = controller.beginPass(0, [], 16, 16384, hint(512));
	previous.observe(4096, 16);
	previous.finish();
	const plan = controller.beginPass(0, [], 16, 16384, hint(4451));
	assert.equal(plan.maximumTilePixels, 1024);
	let count = 0;
	for (const { tile } of plan.tiles()) {
		count++;
		plan.observe(tile.width * tile.height, 16);
		assert.ok(plan.maximumTilePixels <= 4096, 'keep unobserved areas within the initial conservative limit');
	}
	assert.equal(plan.maximumTilePixels, 4096);
	assert.ok(count < 80, `unexpectedly many tile submissions: ${count}`);
});

// 【完了が繰り返し遅れても、64×64pxより細かく分割しない】
// 待ち時間が増大するたびに学習した下限を解除する経路でも固定下限を守り、
// 1024角の画像が数十万回のsubmit・完了待ちへ膨らむのを防ぐ。
test('keeps tiles at least sixty-four pixels wide and high after repeated slow completions', () => {
	const plan = new EffectRenderTileController().beginPass(0, [], 1024, 1024, hint());
	let count = 0;
	for (const { tile } of plan.tiles()) {
		assert.ok(tile.width >= 64);
		assert.ok(tile.height >= 64);
		plan.observe(tile.width * tile.height, 128 * (4 ** (count % 3)));
		assert.ok(plan.maximumTilePixels >= 4096);
		count++;
	}
	assert.equal(plan.maximumTilePixels, 4096);
	assert.equal(count, 256);
});

// 【計算量ヒントが急増しても、最初のタイルから固定下限を守る】
// 完了時間による縮小だけを制限しても、反復数変更時の事前縮小で下限を下回り得る。
// 64px未満の描画先も、その実寸に合わせて全画素を一度で扱えるようにする。
test('clamps workload-based reductions to the minimum dimensions of the target', () => {
	for (const [width, height] of [[1024, 1024], [129, 129], [65, 65], [63, 257], [257, 63], [16, 9]]) {
		const controller = new EffectRenderTileController();
		controller.beginPass(0, [], width, height, hint());
		const plan = controller.beginPass(0, [], width, height, hint(65536));
		assert.equal(plan.maximumTilePixels, Math.min(width, 64) * Math.min(height, 64));
		for (const { tile } of plan.tiles()) {
			assert.ok(tile.width >= Math.min(width, 64));
			assert.ok(tile.height >= Math.min(height, 64));
		}
	}
});
