import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EffectGpuCommandRecorder, effectRenderTiles } from '../src/effect-gpu-command-recorder.ts';
import { createEffectRenderDevice, getEffectRenderViewSize, isEffectRenderPipelineProbeSafe } from '../src/effect-render-device.ts';
import { EffectRenderTileController } from '../src/effect-render-tile-controller.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));

function gpu() {
	const submitted = [];
	const waits = [];
	let lose;
	const device = {
		features: new Set(),
		lost: new Promise(resolve => { lose = resolve; }),
		queue: {
			submit(buffers) { submitted.push(...buffers); },
			onSubmittedWorkDone() { return new Promise(resolve => waits.push(resolve)); },
		},
		createTexture({ size }) {
			return { width: size.width, height: size.height, createView() { return {}; } };
		},
		createBindGroupLayout: descriptor => ({ descriptor }),
		createPipelineLayout: descriptor => ({ descriptor }),
		createRenderPipeline: descriptor => ({ descriptor }),
		async createRenderPipelineAsync(descriptor) { return { descriptor }; },
		createCommandEncoder() {
			const commands = [];
			const pass = (kind, descriptor) => {
				commands.push({ kind, descriptor });
				return new Proxy({}, { get: (_, method) => (...args) => commands.push({ method, args }) });
			};
			return {
				beginRenderPass: descriptor => pass('render', descriptor),
				beginComputePass: descriptor => pass('compute', descriptor),
				clearBuffer: buffer => commands.push({ kind: 'clear', buffer }),
				copyBufferToBuffer: (...args) => commands.push({ method: 'copyBufferToBuffer', args }),
				copyTextureToTexture: (...args) => commands.push({ method: 'copyTextureToTexture', args }),
				finish: () => commands,
			};
		},
	};
	const tracked = createEffectRenderDevice(device);
	const view = tracked.createTexture({ size: { width: 7, height: 5 } }).createView();
	return { device, tracked, view, submitted, waits, lose };
}

function probeSafePipeline(g, entries = []) {
	const group = g.tracked.createBindGroupLayout({ entries });
	return g.tracked.createRenderPipeline({ layout: g.tracked.createPipelineLayout({ bindGroupLayouts: [group] }) });
}

// 【統計の読み出し待ちを次のタイルと重ね、先行投入とreadbackを有界にする】
// mapAsyncの遅延でGPUを毎回遊ばせない一方、未完了の結果バッファを無制限に確保しない。
// 進捗は送信数ではなくGPU完了数で進め、最後には全タイルの統計を合計する。
test('overlaps statistics readbacks and two measured tiles while bounding pending results', async () => {
	const g = gpu();
	g.device.features.add('timestamp-query');
	const view = g.tracked.createTexture({ size: { width: 1536, height: 128 } }).createView();
	const recorder = new EffectGpuCommandRecorder();
	const pass = recorder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] });
	pass.draw(3); pass.end();
	let measurements = 0;
	const readbacks = [];
	const helper = {
		beginRenderPass: (encoder, descriptor) => encoder.beginRenderPass(descriptor),
		getResult() {
			if (++measurements <= 5) return Promise.resolve(1_000_000);
			assert.ok(readbacks.length < 3, 'concurrent submissions cannot overrun the shared readback limit');
			const deferred = Promise.withResolvers(); readbacks.push(deferred); return deferred.promise;
		},
	};
	const progress = [];
	let finished = false;
	const running = recorder.execute(g.device, { mode: 'manual', tileSize: 128 }, new AbortController().signal,
		{ timingHelper: helper, collectStatistics: true, onProgress: value => progress.push(value) });
	void running.then(() => { finished = true; });
	for (let index = 0; index < 5; index++) { g.waits.shift()(); await tick(); }
	assert.equal(g.submitted.length, 7, 'only two tiles are sent ahead after five actual GPU samples');
	assert.deepEqual(progress.at(-1), { completedTiles: 5, totalTiles: 12 });
	g.waits.shift()(); await tick();
	assert.deepEqual(progress.at(-1), { completedTiles: 6, totalTiles: 12 });
	g.waits.shift()(); await tick();
	assert.equal(g.submitted.length, 8);
	assert.equal(readbacks.length, 3, 'the ninth tile waits for a readback slot');
	g.waits.shift()(); await tick();
	assert.equal(g.submitted.length, 8);
	readbacks.shift().resolve(1_000_000); await tick();
	assert.equal(g.submitted.length, 9, 'statistics need not all finish before GPU work resumes');
	for (let index = 0; !finished && index < 100; index++) {
		if (g.waits.length > 0) g.waits.shift()();
		if (readbacks.length > 0) readbacks.shift().resolve(1_000_000);
		await tick();
	}
	assert.equal(await running, 12_000_000);
	assert.equal(g.submitted.length, 12);
	assert.deepEqual(progress.at(-1), { completedTiles: 12, totalTiles: 12 });
	assert.ok(progress.every((value, index) => value.completedTiles === index && value.totalTiles === 12));
});

// 【二枚を送信済みの中断では、両方のGPU完了とreadbackまで資源を保持する】
// 最初の完了だけで呼び出し側へ戻すと、まだ使用中の出力やuniformを破棄してしまう。
test('drains both submitted tiles and their readbacks before reporting cancellation', async () => {
	const g = gpu();
	g.device.features.add('timestamp-query');
	const view = g.tracked.createTexture({ size: { width: 1536, height: 128 } }).createView();
	const recorder = new EffectGpuCommandRecorder();
	const pass = recorder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] });
	pass.draw(3); pass.end();
	let measurements = 0;
	const readbacks = [];
	const helper = {
		beginRenderPass: (encoder, descriptor) => encoder.beginRenderPass(descriptor),
		getResult() {
			if (++measurements <= 5) return Promise.resolve(1_000_000);
			const deferred = Promise.withResolvers(); readbacks.push(deferred); return deferred.promise;
		},
	};
	const abort = new AbortController();
	let finished = false;
	const running = recorder.execute(g.device, { mode: 'manual', tileSize: 128 }, abort.signal, { timingHelper: helper, collectStatistics: true });
	const rejected = assert.rejects(running, { name: 'AbortError' }).then(() => { finished = true; });
	for (let index = 0; index < 5; index++) { g.waits.shift()(); await tick(); }
	assert.equal(g.submitted.length, 7);
	abort.abort();
	g.waits.shift()(); await tick();
	assert.equal(finished, false);
	g.waits.shift()(); await tick();
	assert.equal(finished, false, 'readback resources are still retained');
	for (const readback of readbacks) readback.resolve(1_000_000);
	await rejected;
	assert.equal(g.submitted.length, 7);
});

// 【自動分割の面積変更後も、送信済みタイルを進捗の残数へ含める】
// 二枚目を列挙した時点で未送信キューから消えるため、残数をそこだけから数えると
// 総数が減ったり、GPU完了前に100%になったりする。
test('keeps automatic progress accurate when stable measured tiles are submitted ahead', async () => {
	const g = gpu();
	g.device.features.add('timestamp-query');
	const view = g.tracked.createTexture({ size: { width: 2048, height: 1024 } }).createView();
	const recorder = new EffectGpuCommandRecorder();
	const pass = recorder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] });
	pass.setPipeline(probeSafePipeline(g)); pass.draw(3); pass.end();
	const helper = {
		beginRenderPass: (encoder, descriptor) => encoder.beginRenderPass(descriptor),
		async getResult() {
			const rectangle = g.submitted.at(-1).find(command => command.method === 'setScissorRect').args;
			return rectangle[2] * rectangle[3] / 65536 * 150_000_000;
		},
	};
	const progress = [];
	let finished = false;
	let overlapped = false;
	const running = recorder.execute(g.device, { mode: 'auto' }, new AbortController().signal,
		{ timingHelper: helper, tileController: new EffectRenderTileController(), workloadHint: { key: 'same', workPerPixel: 1 }, onProgress: value => progress.push(value) });
	void running.then(() => { finished = true; });
	for (let index = 0; !finished && index < 200; index++) {
		if (g.waits.length > 1) overlapped = true;
		assert.ok(g.waits.length <= 2);
		g.waits.shift()(); await tick();
	}
	await running;
	assert.equal(overlapped, true);
	assert.ok(progress.every((value, index) => value.completedTiles <= value.totalTiles && (index === 0 || value.completedTiles >= progress[index - 1].completedTiles)));
	assert.equal(progress.at(-1).completedTiles, progress.at(-1).totalTiles);
	assert.equal(progress.at(-1).completedTiles, 32);
});

// 【通常描画の定期計測はコマンドを一度だけ再生し、送信とGPU待機を所有しない】
// Computeやコピーを挟むパスでも元のoperation番号・寸法・pipelineを結果へ対応させ、
// 別パスの時間を学習したり、ナノ秒をミリ秒として扱ったりすることを防ぐ。
test('replays ordinary commands once and reports asynchronous timing for the original render passes', () => {
	const g = gpu();
	const recorder = new EffectGpuCommandRecorder();
	const pipeline = {};
	const view = g.tracked.createTexture({ size: { width: 128, height: 128 } }).createView();
	recorder.encoder.clearBuffer({});
	const first = recorder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] });
	first.setPipeline(pipeline); first.setScissorRect(1, 2, 3, 4); first.draw(3); first.end();
	const compute = recorder.beginComputePass(); compute.dispatchWorkgroups(1); compute.end();
	const last = recorder.beginRenderPass({ colorAttachments: [{ view: g.view, loadOp: 'load', storeOp: 'store' }] });
	last.setPipeline(pipeline); last.draw(3); last.end();
	const callbacks = [];
	const timingHelper = {
		beginRenderPass(encoder, descriptor, onResult) { callbacks.push(onResult); return encoder.beginRenderPass(descriptor); },
		beginComputePass: (encoder, descriptor) => encoder.beginComputePass(descriptor),
	};
	const results = [];
	const encoder = g.device.createCommandEncoder();
	recorder.replayUntiled(encoder, timingHelper, (...args) => results.push(args));
	const commands = encoder.finish();
	assert.deepEqual(commands.filter(command => command.kind != null).map(command => command.kind), ['clear', 'render', 'compute', 'render']);
	assert.deepEqual(commands.filter(command => command.method === 'setScissorRect').map(command => command.args), [[1, 2, 3, 4]]);
	assert.equal(commands.filter(command => command.method === 'draw').length, 2);
	assert.equal(g.submitted.length, 0);
	assert.equal(g.waits.length, 0);
	assert.deepEqual(results, []);
	callbacks[0](2_500_000); callbacks[1](null);
	assert.deepEqual(results, [[1, [pipeline], 128, 128, 2.5], [3, [pipeline], 7, 5, null]]);
});

// 【事前計測を完成タイルへ数えず、最初の本描画のclearで試し描きの結果を消す】
// コントローラーだけ改善しても、実行器が以前の断片化した計画を使うと38タイルが残る。
// 初回に全画面1枚を描き、静止画キャッシュへ入る前に通常描画へ移れることを検証する。
test('probes read-only clear passes before planning the first actual frame', async () => {
	const g = gpu();
	g.device.features.add('timestamp-query');
	const view = g.tracked.createTexture({ size: { width: 1024, height: 1024 } }).createView();
	const recorder = new EffectGpuCommandRecorder();
	const pass = recorder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] });
	pass.setPipeline(probeSafePipeline(g)); pass.draw(3); pass.end();
	const timingHelper = {
		beginRenderPass: (encoder, descriptor) => encoder.beginRenderPass(descriptor),
		async getResult() {
			const rectangle = g.submitted.at(-1).find(command => command.method === 'setScissorRect').args;
			return (10 + rectangle[2] * rectangle[3] * 0.0001) * 1_000_000;
		},
	};
	const controller = new EffectRenderTileController();
	const workload = { key: 'same view', workPerPixel: 1 };
	const progress = [];
	let completed = false;
	const running = recorder.execute(g.device, { mode: 'auto' }, new AbortController().signal, {
		timingHelper, tileController: controller, workloadHint: workload, onProgress: value => progress.push(value),
	});
	void running.then(() => { completed = true; });
	for (let index = 0; !completed && index < 100; index++) { g.waits.shift()(); await tick(); }
	await running;
	assert.equal(g.submitted.length, 11, 'ten probes and one actual full pass');
	assert.ok(g.submitted.every(commands => commands[0].descriptor.colorAttachments[0].loadOp === 'clear'));
	assert.deepEqual(g.submitted.at(-1).find(command => command.method === 'setScissorRect').args, [0, 0, 1024, 1024]);
	assert.deepEqual(progress.at(-1), { completedTiles: 1, totalTiles: 1 });
	assert.ok(progress.slice(0, -1).every(value => value.completedTiles === 0));
	assert.equal(controller.canRenderUntiled(workload), true);
});

// 【storageを書き換えるシェーダー・既存画像へのload・bundleは再実行しない】
// 試し描きで状態を二度更新したり、元の画像へ二重に合成したりすることを防ぐ。
// 外部やauto layoutのpipelineも読み取り専用だと推測せず、従来の一度ずつの分割へ戻す。
test('excludes writable, unknown, loaded, depth and bundled passes from GPU probing', async () => {
	for (const variant of ['storage', 'storage-texture', 'auto-layout', 'external', 'load', 'depth', 'bundle', 'timestamp']) {
		const g = gpu();
		g.device.features.add('timestamp-query');
		const view = g.tracked.createTexture({ size: { width: 1024, height: 1024 } }).createView();
		const pipeline = variant === 'external' ? {} : variant === 'auto-layout' ? g.tracked.createRenderPipeline({ layout: 'auto' })
			: probeSafePipeline(g, variant === 'storage' ? [{ buffer: { type: 'storage' } }]
				: variant === 'storage-texture' ? [{ storageTexture: { format: 'rgba8unorm' } }] : []);
		const recorder = new EffectGpuCommandRecorder();
		const pass = recorder.beginRenderPass({
			colorAttachments: [{ view, loadOp: variant === 'load' ? 'load' : 'clear', storeOp: 'store' }],
			...(variant === 'depth' ? { depthStencilAttachment: { view: g.view } } : {}),
			...(variant === 'timestamp' ? { timestampWrites: { querySet: {}, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {}),
		});
		pass.setPipeline(pipeline);
		if (variant === 'bundle') pass.executeBundles([]);
		else pass.draw(3);
		pass.end();
		const timingHelper = { beginRenderPass: (encoder, descriptor) => encoder.beginRenderPass(descriptor), getResult: async () => 200_000_000 };
		let completed = false;
		const progress = [];
		const running = recorder.execute(g.device, { mode: 'auto' }, new AbortController().signal, {
			timingHelper, tileController: new EffectRenderTileController(), onProgress: value => progress.push(value),
		});
		void running.then(() => { completed = true; });
		for (let index = 0; !completed && index < 300; index++) { g.waits.shift()(); await tick(); }
		await running;
		assert.equal(g.submitted.length, 64, variant);
		assert.deepEqual(progress.at(-1), { completedTiles: 64, totalTiles: 64 });
	}
});

// 【非同期pipelineでも読み取り専用のlayoutだけを事前計測の対象にする】
// asyncで生成されたpipelineを未追跡にすると、エフェクトの初期化方式だけで過分割が戻る。
test('tracks read-only asynchronous pipelines without changing native object identity', async () => {
	const g = gpu();
	const group = g.tracked.createBindGroupLayout({ entries: [{ buffer: { type: 'read-only-storage' } }] });
	const layout = g.tracked.createPipelineLayout({ bindGroupLayouts: [group] });
	const pipeline = await g.tracked.createRenderPipelineAsync({ layout });
	assert.equal(isEffectRenderPipelineProbeSafe(pipeline), true);
	assert.equal(pipeline.descriptor.layout, layout);
	assert.equal(isEffectRenderPipelineProbeSafe({}), false);
});

// 【実行器はナノ秒のGPU実測を制御へ渡し、通知が遅くても初回の分割を粗くする】
// Controller単体だけの対応では、実行器が経過時間を渡し続けたり単位を誤ったりして
// 実際のプレビューが256タイルのままになる。進捗の総数減少と最終完了も併せて検証する。
test('uses GPU timestamps rather than delayed notifications while updating progress', async t => {
	const g = gpu();
	g.device.features.add('timestamp-query');
	let now = 0;
	t.mock.method(performance, 'now', () => now);
	const view = g.tracked.createTexture({ size: { width: 1024, height: 1024 } }).createView();
	const recorder = new EffectGpuCommandRecorder();
	const pass = recorder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] });
	pass.draw(3); pass.end();
	const timingHelper = {
		beginRenderPass: (encoder, descriptor) => encoder.beginRenderPass(descriptor),
		async getResult() {
			const rectangle = g.submitted.at(-1).find(command => command.method === 'setScissorRect').args;
			return rectangle[2] * rectangle[3] * 0.0001 * 1_000_000;
		},
	};
	const progress = [];
	let completed = false;
	const running = recorder.execute(g.device, { mode: 'auto' }, new AbortController().signal, {
		timingHelper, tileController: new EffectRenderTileController(), workloadHint: { key: 'same view', workPerPixel: 1 },
		onProgress: value => progress.push(value),
	});
	void running.then(() => { completed = true; });
	for (let index = 0; !completed && index < 100; index++) {
		now += 1000;
		g.waits.shift()();
		await tick();
	}
	await running;
	assert.equal(completed, true);
	assert.ok(g.submitted.length < 64, `unexpectedly many tile submissions: ${g.submitted.length}`);
	assert.ok(progress.some(value => value.totalTiles < 64));
	assert.deepEqual(progress.at(-1), { completedTiles: g.submitted.length, totalTiles: g.submitted.length });
});

for (const collectStatistics of [false, true]) {
	// 【自動制御の安定後はQueryを間引き、統計が有効なら全タイルを測る】
	// 制御用の間引きを統計の合計へ混ぜるとGPU時間が過小に表示されるため、
	// 既存の統計計測と、自動制御だけが必要な場合の計測範囲を分ける。
	test(`samples stable automatic tiles while collecting full statistics=${collectStatistics}`, async () => {
		const g = gpu();
		g.device.features.add('timestamp-query');
		const view = g.tracked.createTexture({ size: { width: 1024, height: 1024 } }).createView();
		const recorder = new EffectGpuCommandRecorder();
		const pass = recorder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] });
		pass.draw(3); pass.end();
		let measurements = 0;
		const timingHelper = {
			beginRenderPass: (encoder, descriptor) => encoder.beginRenderPass(descriptor),
			async getResult() { measurements++; return 200 * 1_000_000; },
		};
		let completed = false;
		const running = recorder.execute(g.device, { mode: 'auto' }, new AbortController().signal, {
			timingHelper, collectStatistics, tileController: new EffectRenderTileController(),
		});
		void running.then(() => { completed = true; });
		for (let index = 0; !completed && index < 300; index++) { g.waits.shift()(); await tick(); }
		await running;
		assert.equal(g.submitted.length, 64);
		if (collectStatistics) assert.equal(measurements, 64);
		else assert.ok(measurements >= 5 && measurements < 64);
	});
}

// 【エフェクト内の全Render Passを合計し、GPU完了後だけ進捗を進める】
// 最初のパスだけの総数やsubmit時点の完了通知では、まだ未描画なのに100%となってしまう。
// 解像度の異なる後続パスも含め、最後に実際のタイル数と一致することを確認する。
test('reports completed tiles across render passes after GPU completion', async () => {
	const g = gpu();
	const recorder = new EffectGpuCommandRecorder();
	const secondView = g.tracked.createTexture({ size: { width: 3, height: 3 } }).createView();
	for (const view of [g.view, secondView]) {
		const pass = recorder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] });
		pass.draw(3); pass.end();
	}
	const progress = [];
	const running = recorder.execute(g.device, { mode: 'manual', tileSize: 4 }, new AbortController().signal, {
		onProgress: value => progress.push(value),
	});
	assert.deepEqual(progress, [{ completedTiles: 0, totalTiles: 5 }]);
	assert.equal(g.submitted.length, 1);
	for (let completedTiles = 1; completedTiles <= 5; completedTiles++) {
		g.waits.shift()();
		await tick();
		assert.deepEqual(progress.at(-1), { completedTiles, totalTiles: 5 });
	}
	await running;
	assert.equal(progress.length, 6);
});

// 【奇数寸法と細長い画像を重複も欠落もなく分割する】
// 端数や空タイルで画素が失われると、タイル寸法によってエフェクトの結果が変わる。
test('covers every pixel exactly once at each manual tile size', () => {
	for (const [width, height] of [[7, 5], [1, 9], [2, 1]]) {
		for (const tileSize of [1, 2, 4, 8, 512]) {
			const counts = new Uint8Array(width * height);
			for (const { tile } of effectRenderTiles(width, height, tileSize)) {
				assert.ok(tile.width > 0 && tile.height > 0);
				for (let y = tile.y; y < tile.y + tile.height; y++) for (let x = tile.x; x < tile.x + tile.width; x++) counts[y * width + x]++;
			}
			assert.ok(counts.every(count => count === 1));
		}
	}
	for (const tileSize of [-1, 0, 0.5, Infinity]) assert.throws(() => [...effectRenderTiles(7, 5, tileSize)]);
});

// 【描画先のmip寸法をGPUオブジェクトの同一性を保って記録する】
// 中間画像は出力と解像度が異なるため、出力サイズを流用すると範囲外Scissorになる。
test('tracks mip dimensions without replacing native textures or changing the original device', () => {
	const g = gpu();
	const texture = g.tracked.createTexture({ size: { width: 13, height: 7 } });
	assert.deepEqual(getEffectRenderViewSize(texture.createView({ baseMipLevel: 1 })), { width: 6, height: 3 });
	assert.equal(g.tracked.queue, g.device.queue);
	assert.equal(g.device.createTexture({ size: { width: 1, height: 1 } }).createView().constructor, Object);
});

// 【パスの順序とScissor・uniformオフセットを保持し、GPU完了まで次を送らない】
// 全タイルの一括送信では長時間バッチを防げず、各タイルのclearでは既存の結果を消してしまう。
// Computeは一度だけ実行し、mutableなdynamic offsetsは呼び出し時の値を使う。
test('serializes tiles and preserves clears, scissors, mutable offsets and compute ordering', async () => {
	const g = gpu();
	const recorder = new EffectGpuCommandRecorder();
	const pass = recorder.beginRenderPass({ colorAttachments: [{ view: g.view, loadOp: 'clear', storeOp: 'store' }] });
	const offsets = new Uint32Array([256]);
	pass.setBindGroup(0, {}, offsets);
	offsets[0] = 512;
	pass.setScissorRect(2, 1, 4, 3);
	pass.draw(3);
	pass.end();
	recorder.encoder.clearBuffer({ id: 'buffer' });
	const compute = recorder.beginComputePass();
	compute.dispatchWorkgroups(8, 3);
	compute.end();
	const output = recorder.beginRenderPass({ colorAttachments: [{ view: g.view, loadOp: 'load', storeOp: 'store' }] });
	output.draw(3);
	output.end();
	const running = recorder.execute(g.device, { mode: 'manual', tileSize: 4 }, new AbortController().signal);
	assert.equal(g.submitted.length, 1);
	await tick();
	assert.equal(g.submitted.length, 1);
	for (let index = 0; index < 10; index++) {
		assert.equal(g.submitted.length, index + 1);
		g.waits.shift()();
		await tick();
	}
	assert.equal(await running, 0);
	assert.equal(g.submitted[0][0].descriptor.colorAttachments[0].loadOp, 'clear');
	for (const commands of g.submitted.slice(1, 4)) assert.equal(commands[0].descriptor.colorAttachments[0].loadOp, 'load');
	assert.deepEqual(g.submitted[0].filter(command => command.method === 'setScissorRect').at(-1).args, [2, 1, 2, 3]);
	assert.equal(g.submitted[0].find(command => command.method === 'setBindGroup').args[2][0], 256);
	assert.equal(g.submitted[4][0].kind, 'clear');
	assert.equal(g.submitted[5][0].kind, 'compute');
	assert.deepEqual(g.submitted[5].find(command => command.method === 'dispatchWorkgroups').args, [8, 3]);
});

// 【中断しても送信済みタイルを待ち、未送信の仕事は実行しない】
// 即座のリソース破棄や後続パスの開始が、旧フレームと新フレームの競合を起こすのを防ぐ。
test('stops at a completed tile boundary when aborted', async () => {
	const g = gpu();
	const recorder = new EffectGpuCommandRecorder();
	const pass = recorder.beginRenderPass({ colorAttachments: [{ view: g.view, loadOp: 'clear', storeOp: 'store' }] });
	pass.draw(3); pass.end();
	const controller = new AbortController();
	const running = recorder.execute(g.device, { mode: 'manual', tileSize: 2 }, controller.signal);
	const rejected = assert.rejects(running, { name: 'AbortError' });
	controller.abort();
	assert.equal(g.submitted.length, 1);
	g.waits.shift()();
	await rejected;
	assert.equal(g.submitted.length, 1);
});

// 【GPU喪失で完了通知が返らない場合にも実行を終了する】
// タイムアウト対策の処理自体が停止したままにならず、所有者へ診断を返す必要がある。
test('rejects device loss without waiting for a stuck completion notification', async () => {
	const g = gpu();
	const recorder = new EffectGpuCommandRecorder();
	const compute = recorder.beginComputePass(); compute.dispatchWorkgroups(1); compute.end();
	const running = recorder.execute(g.device, { mode: 'manual', tileSize: 4 }, new AbortController().signal);
	const rejected = assert.rejects(running, /test device lost/);
	g.lose({ message: 'test device lost' });
	await rejected;
});

// 【コピー用の座標を固定しつつ、GPUリソースの同一性を維持する】
// descriptorだけを複製し、GPUBufferやGPUTextureまでプレーンなオブジェクトへ変換しない。
test('snapshots copy coordinates without cloning native buffer resources', async () => {
	const g = gpu();
	const recorder = new EffectGpuCommandRecorder();
	const source = {}, destination = {};
	const origin = [1, 2, 0];
	recorder.encoder.copyBufferToBuffer(source, 0, destination, 0, 4);
	recorder.encoder.copyTextureToTexture({ texture: source, origin }, { texture: destination }, [1, 1, 1]);
	origin[0] = 99;
	const running = recorder.execute(g.device, { mode: 'manual', tileSize: 4 }, new AbortController().signal);
	for (let index = 0; index < 2; index++) { g.waits.shift()(); await tick(); }
	await running;
	assert.equal(g.submitted[0][0].args[0], source);
	assert.equal(g.submitted[0][0].args[2], destination);
	assert.equal(g.submitted[1][0].args[0].texture, source);
	assert.deepEqual(g.submitted[1][0].args[0].origin, [1, 2, 0]);
});

// 【先行するGPU処理を待ってから計測し、遅いタイルの次の未送信領域を小さくする】
// Queryなしでも実行中のパスを調整でき、完了済みの画素をclearしてしまわないことを検証する。
// 初期サイズと固定下限はともに128pxなので、大きなタイルを学習済みの状態から縮小を確認する。
test('adapts remaining tiles using completion time while preserving clears', async t => {
	const g = gpu();
	let now = 0;
	t.mock.method(performance, 'now', () => now);
	const view = g.tracked.createTexture({ size: { width: 1025, height: 513 } }).createView();
	const recorder = new EffectGpuCommandRecorder();
	const pass = recorder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] });
	pass.draw(3); pass.end();
	const tileController = new EffectRenderTileController();
	const workloadHint = { key: 'same input', workPerPixel: 1 };
	const progress = [];
	for (let passIndex = 0; passIndex < 2; passIndex++) {
		const plan = tileController.beginPass(0, [], 1025, 513, workloadHint);
		for (let index = 0; index < 4; index++) plan.observe(plan.maximumTilePixels, 1);
		plan.finish();
	}
	const running = recorder.execute(g.device, { mode: 'auto' }, new AbortController().signal, {
		tileController, workloadHint, onProgress: value => progress.push(value),
	});
	assert.equal(g.submitted.length, 0);
	await tick();
	assert.equal(g.submitted.length, 0, 'do not submit until previous work has completed');
	now = 1000;
	g.waits.shift()();
	await tick();
	const rectangle = commands => commands.find(command => command.method === 'setScissorRect').args;
	const first = rectangle(g.submitted[0]);
	assert.ok(first[2] * first[3] > 16384 && first[2] * first[3] <= 65536);
	now += 128;
	g.waits.shift()();
	await tick();
	const second = rectangle(g.submitted[1]);
	assert.ok(second[2] * second[3] < first[2] * first[3]);
	assert.equal(progress[1].completedTiles, 1);
	assert.ok(progress[1].totalTiles > progress[0].totalTiles, 'include newly subdivided tiles in the total');
	let completed = false;
	void running.then(() => { completed = true; });
	for (let index = 0; !completed && index < 500; index++) {
		now += 1;
		g.waits.shift()();
		await tick();
	}
	assert.equal(completed, true);
	assert.equal(await running, 0, 'elapsed time is not reported as GPU timestamp statistics');
	assert.deepEqual(progress.at(-1), { completedTiles: g.submitted.length, totalTiles: g.submitted.length });
	assert.ok(progress.every((value, index) => value.completedTiles === index && value.completedTiles <= value.totalTiles));
	assert.equal(g.submitted[0][0].descriptor.colorAttachments[0].loadOp, 'clear');
	for (const commands of g.submitted.slice(1)) assert.equal(commands[0].descriptor.colorAttachments[0].loadOp, 'load');
});
