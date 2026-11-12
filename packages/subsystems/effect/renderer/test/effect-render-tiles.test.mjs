import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EffectGpuCommandRecorder, effectRenderTiles } from '../src/effect-gpu-command-recorder.ts';
import { createEffectRenderDevice, getEffectRenderViewSize } from '../src/effect-render-texture-views.ts';
import { EffectRenderTileController } from '../src/effect-render-tile-controller.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));

function gpu() {
	const submitted = [];
	const waits = [];
	let lose;
	const device = {
		lost: new Promise(resolve => { lose = resolve; }),
		queue: {
			submit(buffers) { submitted.push(...buffers); },
			onSubmittedWorkDone() { return new Promise(resolve => waits.push(resolve)); },
		},
		createTexture({ size }) {
			return { width: size.width, height: size.height, createView() { return {}; } };
		},
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
	const running = recorder.execute(g.device, { mode: 'manual', tileSize: 4 }, new AbortController().signal, null, null, null,
		value => progress.push(value));
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
	const running = recorder.execute(g.device, { mode: 'manual', tileSize: 4 }, new AbortController().signal, null);
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
	const running = recorder.execute(g.device, { mode: 'manual', tileSize: 2 }, controller.signal, null);
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
	const running = recorder.execute(g.device, { mode: 'manual', tileSize: 4 }, new AbortController().signal, null);
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
	const running = recorder.execute(g.device, { mode: 'manual', tileSize: 4 }, new AbortController().signal, null);
	for (let index = 0; index < 2; index++) { g.waits.shift()(); await tick(); }
	await running;
	assert.equal(g.submitted[0][0].args[0], source);
	assert.equal(g.submitted[0][0].args[2], destination);
	assert.equal(g.submitted[1][0].args[0].texture, source);
	assert.deepEqual(g.submitted[1][0].args[0].origin, [1, 2, 0]);
});

// 【先行するGPU処理を待ってから計測し、遅いタイルの次の未送信領域を小さくする】
// Queryなしでも実行中のパスを調整でき、完了済みの画素をclearしてしまわないことを検証する。
// 初期サイズと固定下限はともに64pxなので、大きなタイルを学習済みの状態から縮小を確認する。
test('adapts remaining tiles using completion time while preserving clears', async t => {
	const g = gpu();
	let now = 0;
	t.mock.method(performance, 'now', () => now);
	const view = g.tracked.createTexture({ size: { width: 257, height: 129 } }).createView();
	const recorder = new EffectGpuCommandRecorder();
	const pass = recorder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] });
	pass.draw(3); pass.end();
	const tileController = new EffectRenderTileController();
	const workloadHint = { key: 'same input', workPerPixel: 1 };
	const progress = [];
	for (let passIndex = 0; passIndex < 2; passIndex++) {
		const plan = tileController.beginPass(0, [], 257, 129, workloadHint);
		for (let index = 0; index < 4; index++) plan.observe(plan.maximumTilePixels, 1);
		plan.finish();
	}
	const running = recorder.execute(g.device, { mode: 'auto' }, new AbortController().signal, null, tileController, workloadHint,
		value => progress.push(value));
	assert.equal(g.submitted.length, 0);
	await tick();
	assert.equal(g.submitted.length, 0, 'do not submit until previous work has completed');
	now = 1000;
	g.waits.shift()();
	await tick();
	const rectangle = commands => commands.find(command => command.method === 'setScissorRect').args;
	const first = rectangle(g.submitted[0]);
	assert.ok(first[2] * first[3] > 4096 && first[2] * first[3] <= 16384);
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
