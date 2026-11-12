import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EffectRenderTileController } from '../src/effect-render-tile-controller.ts';

const hint = (workPerPixel = 1, key = 'same input') => ({ workPerPixel, key });

// 【計測領域で本描画を断片化せず、固定費があっても初回から全画面で描ける】
// 以前は四隅・中央の小タイルが未送信領域に穴を開け、軽い描画でも38タイル程度残った。
// 小タイルの固定費も画素単価へ混ぜ続けず、異なる面積の計測から分離する。
test('renders a light first frame in one tile after separate GPU probes with fixed costs', () => {
	for (const fixedMs of [0, 10]) {
		const controller = new EffectRenderTileController();
		const plan = controller.beginPass(0, [], 1024, 1024, hint(), true);
		const probes = [];
		for (const tile of plan.gpuProbes()) {
			probes.push(tile);
			assert.ok(tile.width >= 128 && tile.height >= 128);
			plan.observeGpuProbe(fixedMs + tile.width * tile.height * 0.0001);
		}
		assert.equal(probes.length, 10);
		assert.equal(plan.remainingTileCount, 1);
		const actual = [...plan.tiles()];
		assert.deepEqual(actual, [{ tile: { x: 0, y: 0, width: 1024, height: 1024 }, last: true }]);
		plan.observe(1024 * 1024, 1000, fixedMs + 104.8576);
		plan.finish();
		assert.equal(controller.canRenderUntiled(hint()), true, 'a cached static frame must not need a second draw to finish learning');
		const next = controller.beginPass(0, [], 1024, 1024, hint(), true);
		assert.deepEqual([...next.gpuProbes()], [], 'reuse the validated plan for identical conditions');
	}
});

// 【解像度を上げた後に下げても、その描画内で軽い分割計画へ戻る】
// レンダラー再作成とヒント変更の両方を再現し、視点移動や低解像度への変更で
// 再び小タイルから始めても、次の静止画更新を待たずに分割を解除できることを守る。
test('replans within each draw after resolution and view changes', () => {
	for (const withHint of [false, true]) {
		for (const size of [1024, 2048, 1024, 512, 256]) {
			const controller = new EffectRenderTileController();
			for (const key of ['first view', 'moved view']) {
				const workload = withHint ? hint(1, key) : null;
				const plan = controller.beginPass(0, [], size, size, workload, true);
				for (const tile of plan.gpuProbes()) plan.observeGpuProbe(0.2 + tile.width * tile.height * 0.00005);
				const actual = [...plan.tiles()];
				assert.equal(actual.length, 1, `unnecessary tiles at ${size}px, hint=${withHint}, ${key}`);
				plan.observe(size * size, 1000, 0.2 + size * size * 0.00005);
				plan.finish();
				assert.equal(controller.canRenderUntiled(workload), withHint);
			}
		}
	}
});

// 【重い領域や不正な計測があれば、事前計測だけを根拠に全画面へ拡大しない】
// 四隅の一箇所だけが重い描画、極端に遅い最初の計測、0・負値・欠測を安全側に扱う。
// 計測を本描画のcoverageへ混ぜないことと、128pxの固定下限も確認する。
test('keeps bounded tiles for expensive regions and invalid GPU probes', () => {
	for (const duration of [200, 501, 0, -1, NaN, null]) {
		const plan = new EffectRenderTileController().beginPass(0, [], 257, 129, hint(), true);
		let probes = 0;
		for (const _tile of plan.gpuProbes()) plan.observeGpuProbe(probes++ === 0 ? duration : 1);
		assert.ok(probes <= 5);
		assert.ok(plan.maximumTilePixels >= 16384 && plan.maximumTilePixels < 257 * 129);
		const coverage = new Uint8Array(257 * 129);
		for (const { tile } of plan.tiles()) {
			assert.ok(tile.width >= 128 && tile.height >= 128);
			for (let y = tile.y; y < tile.y + tile.height; y++) for (let x = tile.x; x < tile.x + tile.width; x++) coverage[y * 257 + x]++;
		}
		assert.ok(coverage.every(count => count === 1));
	}
});

// 【通知が遅くても実GPU時間が短ければ、初回の途中から面積を段階的に拡大する】
// 1枚を描き終わるまで64pxへ固定する旧制御では、軽い静止画も256回の完了待ちになる。
// 最初の計測を四隅と中央へ分散し、画素の重複・欠落を出さずに待機回数を減らす。
test('grows tiles within the first GPU-timed pass despite slow completion notifications', () => {
	const controller = new EffectRenderTileController();
	const plan = controller.beginPass(0, [], 1024, 1024, hint(), true);
	const probes = [[0, 0], [1023, 1023], [1023, 0], [0, 1023], [511, 511]];
	const coverage = new Uint8Array(1024 * 1024);
	let completed = 0;
	for (const { tile } of plan.tiles()) {
		if (completed < probes.length) {
			const [x, y] = probes[completed];
			assert.ok(x >= tile.x && x < tile.x + tile.width && y >= tile.y && y < tile.y + tile.height);
		}
		for (let y = tile.y; y < tile.y + tile.height; y++) for (let x = tile.x; x < tile.x + tile.width; x++) coverage[y * 1024 + x]++;
		const previousLimit = plan.maximumTilePixels;
		plan.observe(tile.width * tile.height, 1000, tile.width * tile.height * 0.0001);
		assert.ok(plan.maximumTilePixels <= previousLimit * 2);
		completed++;
	}
	assert.ok(completed < 64, `unexpectedly many GPU submissions: ${completed}`);
	assert.ok(coverage.every(value => value === 1));
	assert.equal(plan.remainingTileCount, 0);
	plan.finish();
	assert.equal(controller.canRenderUntiled(hint()), false, 'measure a full pass before returning to ordinary rendering');
	const next = controller.beginPass(0, [], 1024, 1024, hint(), true);
	const tiles = [...next.tiles()];
	assert.equal(tiles.length, 1);
	next.observe(1024 * 1024, 1000, 100);
	next.finish();
	assert.equal(controller.canRenderUntiled(hint()), true);
	assert.equal(controller.canRenderUntiled(hint(2)), false);
	assert.equal(controller.canRenderUntiled(hint(1, 'another view')), false);
});

// 【実GPU時間が500msの予算を超えたら、通知遅延の連続回数を待たずに縮小する】
// 経過時間の揺らぎ対策をGPUの実測へ適用すると、重いタイルを何回も送ってしまう。
// 500ms以内のパスは通知だけが遅くても縮小せず、計算量ヒントの増加は事前に反映する。
test('uses a 500ms GPU budget and scales learned sizes down before workload increases', () => {
	for (const duration of [499, 500, 501]) {
		const controller = new EffectRenderTileController();
		const first = controller.beginPass(0, [], 1024, 1024, hint(), true);
		for (const { tile } of first.tiles()) first.observe(tile.width * tile.height, 1000, tile.width * tile.height * 0.0001);
		first.finish();
		const plan = controller.beginPass(0, [], 1024, 1024, hint(), true);
		for (const { tile } of plan.tiles()) plan.observe(tile.width * tile.height, 2000, duration);
		if (duration <= 500) assert.equal(plan.maximumTilePixels, 1024 * 1024);
		else assert.ok(plan.maximumTilePixels < 1024 * 1024);
		plan.finish();
		assert.equal(controller.canRenderUntiled(hint()), false);
	}
	const controller = new EffectRenderTileController();
	const initial = controller.beginPass(0, [], 1024, 1024, hint(), true);
	for (const { tile } of initial.tiles()) initial.observe(tile.width * tile.height, 1000, tile.width * tile.height * 0.0001);
	initial.finish();
	assert.equal(controller.beginPass(0, [], 1024, 1024, hint(8), true).maximumTilePixels, 131072);
	assert.equal(controller.beginPass(0, [], 1024, 1024, hint(8), false).maximumTilePixels, 16384);
});

// 【重い領域の画素単価を保持し、軽い領域を続けて通っただけでは拡大しない】
// マンデルブロ集合などの局所差を考慮しない平均値だけの学習は、後続領域を過大な
// タイルで送る原因になる。timestampが不正な場合も軽い処理として扱わない。
test('retains the worst measured GPU cost and rejects invalid timestamp samples', () => {
	const plan = new EffectRenderTileController().beginPass(0, [], 1024, 1024, hint(), true);
	plan.observe(16384, 40, 200);
	for (let index = 0; index < 10; index++) plan.observe(16384, 40, 1);
	assert.equal(plan.maximumTilePixels, 16384);
	for (const duration of [0, -1, NaN, Infinity]) {
		plan.observe(16384, 1000, duration);
		assert.equal(plan.maximumTilePixels, 16384);
		assert.equal(plan.shouldMeasureGpuTime(16384), true);
	}
});

// 【タイル寸法が安定したらGPU計測を間引き、未計測タイルだけでは拡大しない】
// 計測を全タイルへ常時付ける必要はなく、安定後のreadbackを減らせる。
// 間引いたタイルで大きな待ち時間が出た場合は、次のタイルを実測して再確認する。
test('samples stable GPU tiles periodically and rechecks after a long unmeasured wait', () => {
	const plan = new EffectRenderTileController().beginPass(0, [], 1024, 1024, hint(), true);
	let measurements = 0;
	for (let index = 0; index < 40; index++) {
		const measured = plan.shouldMeasureGpuTime(16384);
		plan.observe(16384, 250, measured ? 200 : null);
		if (measured) measurements++;
	}
	assert.ok(measurements >= 5 && measurements < 20);
	plan.observe(16384, 1000);
	assert.equal(plan.maximumTilePixels, 16384);
	assert.equal(plan.shouldMeasureGpuTime(16384), true);
});

// 【進捗用の未送信タイル数を、実際の分割と端数・細長い描画先でも一致させる】
// 面積を単純に割るだけでは128pxの寸法下限や二分の端数を反映できず、
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
	controller.beginPass(0, [], 16, 2048, hint());
	const plan = controller.beginPass(0, [], 16, 2048, hint(65536));
	assert.equal(plan.remainingTileCount, 16);
	const tiles = plan.tiles();
	for (let index = 0; index < 4; index++) {
		const { tile } = tiles.next().value;
		plan.observe(tile.width * tile.height, 1);
	}
	const { tile } = tiles.next().value;
	assert.equal(tile.width * tile.height, 4096);
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
	assert.equal(plan.maximumTilePixels, 16384);
	for (let index = 0; index < 3; index++) plan.observe(16384, 1);
	assert.equal(plan.maximumTilePixels, 16384);
	plan.observe(16384, 1);
	assert.equal(plan.maximumTilePixels, 16384, 'do not enlarge unobserved regions in the same pass');
	plan.finish();
	assert.equal(plan.maximumTilePixels, 32768);
	plan.observe(32768, 64);
	assert.equal(plan.maximumTilePixels, 32768, 'a single delayed completion must not subdivide');
	plan.observe(32768, 64);
	plan.observe(32768, 64);
	assert.equal(plan.maximumTilePixels, 16384);
});

// 【同じ条件での計算量増加を、最初のタイルを送信する前に反映する】
// 前回の軽い反復数で学習した面積を、そのまま高反復のフレームへ使わない。
// 条件・pipeline・描画寸法が変わった場合も、別の処理の学習を流用しない。
test('scales down before workload increases and resets incompatible measurements', () => {
	const controller = new EffectRenderTileController();
	const pipeline = {};
	const plan = controller.beginPass(0, [pipeline], 1024, 1024, hint(10));
	for (let index = 0; index < 4; index++) plan.observe(16384, 1);
	plan.finish();
	assert.equal(controller.beginPass(0, [pipeline], 1024, 1024, hint(80)).maximumTilePixels, 16384);
	assert.equal(controller.beginPass(0, [pipeline], 1024, 1024, hint(10)).maximumTilePixels, 16384);
	assert.equal(controller.beginPass(0, [pipeline], 1024, 1024, hint(10, 'new view')).maximumTilePixels, 16384);
	assert.equal(controller.beginPass(0, [{}], 1024, 1024, hint()).maximumTilePixels, 16384);
	assert.equal(controller.beginPass(0, [pipeline], 16, 9, hint()).maximumTilePixels, 144);
});

// 【入力を比較できない処理は描画ごとに小さいタイルから確認する】
// カスタムシェーダーや動画入力の前フレームだけが軽かった場合にも、初回の安全策を残す。
test('does not reuse a large initial tile without a workload hint', () => {
	const controller = new EffectRenderTileController();
	const plan = controller.beginPass(0, [], 1024, 1024, null);
	for (let index = 0; index < 4; index++) plan.observe(16384, 1);
	plan.finish();
	assert.equal(plan.maximumTilePixels, 32768);
	assert.equal(controller.beginPass(0, [], 1024, 1024, null).maximumTilePixels, 16384);
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
			assert.ok(tile.width >= Math.min(width, 128));
			assert.ok(tile.height >= Math.min(height, 128));
			assert.ok(tile.width * tile.height <= plan.maximumTilePixels || Math.max(tile.width, tile.height) < 256,
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
	assert.equal(plan.maximumTilePixels, 262144);
	for (let index = 0; index < 3; index++) plan.observe(262144, 64);
	assert.equal(plan.maximumTilePixels, 65536);
	for (let index = 0; index < 5; index++) plan.observe(65536, 64);
	assert.equal(plan.maximumTilePixels, 65536);
	plan.observe(65536, 256);
	assert.equal(plan.maximumTilePixels, 16384);
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
			plan.observe(tile.width * tile.height, tileCount % 16 < delayedSamples ? 40 : 1);
			assert.equal(plan.maximumTilePixels, 65536);
		}
		assert.equal(tileCount, 32);
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
	for (let index = 0; index < 3; index++) plan.observe(262144, 64);
	assert.equal(plan.maximumTilePixels, 65536);
	for (let index = 0; index < 8; index++) plan.observe(65536, 1);
	for (let index = 0; index < 3; index++) plan.observe(65536, 64);
	assert.equal(plan.maximumTilePixels, 65536);
	for (let index = 0; index < 8; index++) plan.observe(65536, 1);
	for (let index = 0; index < 3; index++) plan.observe(65536, 64);
	assert.equal(plan.maximumTilePixels, 65536);
	plan.observe(65536, 256);
	assert.equal(plan.maximumTilePixels, 16384);
});

// 【反復数変更で安全側に縮小した面積を、同じ描画内で保守的な初期上限まで戻す】
// 片辺が128px未満で初期面積より下限が小さい描画先でも、反復数変更後の細分化を維持しない。
// 通知の固定費が8msを超えていても、32msの目標に余裕が続けば回復できるようにする。
test('recovers conservative tile sizes within a pass after a large workload increase', () => {
	const controller = new EffectRenderTileController();
	const previous = controller.beginPass(0, [], 16, 16384, hint(512));
	previous.observe(16384, 16);
	previous.finish();
	const plan = controller.beginPass(0, [], 16, 16384, hint(4451));
	assert.equal(plan.maximumTilePixels, 2048);
	let count = 0;
	for (const { tile } of plan.tiles()) {
		count++;
		plan.observe(tile.width * tile.height, 16);
		assert.ok(plan.maximumTilePixels <= 16384, 'keep unobserved areas within the initial conservative limit');
	}
	assert.equal(plan.maximumTilePixels, 16384);
	assert.ok(count < 80, `unexpectedly many tile submissions: ${count}`);
});

// 【完了が繰り返し遅れても、128×128pxより細かく分割しない】
// 待ち時間が増大するたびに学習した下限を解除する経路でも固定下限を守り、
// 1024角の画像が数十万回のsubmit・完了待ちへ膨らむのを防ぐ。
test('keeps tiles at least 128 pixels wide and high after repeated slow completions', () => {
	const plan = new EffectRenderTileController().beginPass(0, [], 1024, 1024, hint());
	let count = 0;
	for (const { tile } of plan.tiles()) {
		assert.ok(tile.width >= 128);
		assert.ok(tile.height >= 128);
		plan.observe(tile.width * tile.height, 128 * (4 ** (count % 3)));
		assert.ok(plan.maximumTilePixels >= 16384);
		count++;
	}
	assert.equal(plan.maximumTilePixels, 16384);
	assert.equal(count, 64);
});

// 【計算量ヒントが急増しても、最初のタイルから固定下限を守る】
// 完了時間による縮小だけを制限しても、反復数変更時の事前縮小で下限を下回り得る。
// 128px未満の描画先も、その実寸に合わせて全画素を一度で扱えるようにする。
test('clamps workload-based reductions to the minimum dimensions of the target', () => {
	for (const [width, height] of [[1024, 1024], [257, 257], [255, 255], [128, 129], [129, 129], [127, 257], [257, 127], [65, 65], [63, 257], [257, 63], [16, 9]]) {
		const controller = new EffectRenderTileController();
		controller.beginPass(0, [], width, height, hint());
		const plan = controller.beginPass(0, [], width, height, hint(65536));
		assert.equal(plan.maximumTilePixels, Math.min(width, 128) * Math.min(height, 128));
		for (const { tile } of plan.tiles()) {
			assert.ok(tile.width >= Math.min(width, 128));
			assert.ok(tile.height >= Math.min(height, 128));
		}
	}
});
