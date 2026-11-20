import { createEffectInstance } from '../src/create-effect-instance.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEffectGpuExecution } from '../src/effect-gpu-execution.ts';
import { createEffectRenderDevice } from '../src/tiling/effect-render-device.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
function gpu() {
	const textures = [];
	const passes = [];
	const device = {
		features: new Set(),
		limits: { maxTextureDimension2D: 8192 },
		createShaderModule: () => ({}),
		queue: { submit() { assert.fail('the caller must own submit'); } },
		createTexture({ size, port, format }) {
			const texture = { width: size.width, height: size.height, port, format, destroyed: 0,
				createView() { return { texture }; }, destroy() { this.destroyed++; } };
			textures.push(texture);
			return texture;
		},
	};
	const encoder = {
		beginRenderPass(descriptor) { const pass = { type: 'render', descriptor, draw() {}, end() {} }; passes.push(pass); return pass; },
		beginComputePass(descriptor) { const pass = { type: 'compute', descriptor }; passes.push(pass); return pass; },
	};
	return { textures, passes, device, encoder, wgpu: { device, defaultVertexShaderModule: {}, enable32bitDataTextures: false } };
}

function enableControlledTiledGpu(g) {
	const waits = [];
	const submissions = [];
	g.device.queue = { submit: commands => submissions.push(commands), onSubmittedWorkDone: () => new Promise(resolve => waits.push(resolve)) };
	g.device.createCommandEncoder = () => ({
		beginRenderPass: () => ({ setScissorRect() {}, draw() {}, end() {} }),
		finish: () => ({}),
	});
	return { waits, submissions, finish: async () => { waits.shift()(); await tick(); } };
}

function enableAsynchronousTimestampGpu(t, g) {
	const globals = ['GPUBufferUsage', 'GPUMapMode'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
	globalThis.GPUBufferUsage = { QUERY_RESOLVE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8 };
	globalThis.GPUMapMode = { READ: 1 };
	t.after(() => { for (const [name, descriptor] of globals) {
		if (descriptor != null) Object.defineProperty(globalThis, name, descriptor);
		else delete globalThis[name];
	} });
	const pending = [];
	const control = { pending, holdReadbacks: false, failNextReadback: false, gpuTimeMs: 1, queueWaits: 0, queries: 0 };
	g.device.features = new Set(['timestamp-query']);
	g.device.queue = { submit() {}, onSubmittedWorkDone() { control.queueWaits++; return Promise.resolve(); } };
	g.device.createQuerySet = ({ count }) => ({ timestamps: new BigUint64Array(count), destroy() {} });
	g.device.createBuffer = ({ size }) => ({ size, data: new ArrayBuffer(size), destroyed: false, readback: null,
		mapAsync() {
			if (control.failNextReadback) {
				control.failNextReadback = false;
				return Promise.reject(new Error('timestamp readback failed'));
			}
			if (!control.holdReadbacks) return Promise.resolve();
			this.readback = Promise.withResolvers(); pending.push(this.readback); return this.readback.promise;
		},
		getMappedRange() { if (this.destroyed) throw new Error('buffer disposed'); return this.data; }, unmap() {},
		destroy() { this.destroyed = true; this.readback?.reject(new Error('buffer disposed')); },
	});
	g.device.createCommandEncoder = () => ({
		beginRenderPass(descriptor) {
			if (descriptor.timestampWrites != null) {
				control.queries++;
				const { querySet, beginningOfPassWriteIndex, endOfPassWriteIndex } = descriptor.timestampWrites;
				querySet.timestamps[beginningOfPassWriteIndex] = 100n;
				querySet.timestamps[endOfPassWriteIndex] = 100n + BigInt(control.gpuTimeMs * 1_000_000);
			}
			return { setScissorRect() {}, draw() {}, end() {} };
		},
		resolveQuerySet(querySet, start, count, buffer, offset) { new BigUint64Array(buffer.data, offset).set(querySet.timestamps.subarray(start, start + count)); },
		copyBufferToBuffer(source, sourceOffset, target, targetOffset, size) { new Uint8Array(target.data, targetOffset, size).set(new Uint8Array(source.data, sourceOffset, size)); },
		finish: () => ({}),
	});
	return control;
}

function passExecution(t, g, report, hint = () => ({ key: 'constant', workPerPixel: 1 }), longRunning = true) {
	const device = createEffectRenderDevice(g.device);
	const target = device.createTexture({ size: { width: 16, height: 9 }, format: 'rgba16float', usage: 16 });
	const view = target.createView();
	const execution = createEffectGpuExecution(g.device, { getRenderWorkloadHint: hint, render({ commandEncoder }) {
		const pass = commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }); pass.draw(3); pass.end();
	} }, { mode: 'auto' }, longRunning, report);
	t.after(() => { execution.dispose(); target.destroy(); });
	return execution;
}
const frame = { time: 0, timeDelta: 0 };
for (const collectStatistics of [false, true]) {
	// 【通常描画の定期計測中も後続フレームを描き、重い結果は到着後だけ反映する】
	// 既知の軽い処理を計測目的でタイル経路へ戻すと、readbackの完了まで表示が止まる。
	// 統計のQueryも共有し、計測の重複と追加のGPU完了待ちがないことを守る。
	test(`keeps ordinary frames running during periodic GPU readback with statistics=${collectStatistics}`, async t => {
		const g = gpu();
		const control = enableAsynchronousTimestampGpu(t, g);
		const renderer = passExecution(t, g, collectStatistics ? () => {} : undefined);
		assert.equal(renderer.shouldTile(), true);
		await renderer.renderTiled(frame, new AbortController().signal);
		const draw = () => {

			assert.equal(renderer.shouldTile(), false);
			const encoder = g.device.createCommandEncoder();
			assert.equal(renderer.record(frame, encoder), undefined, 'ordinary render stays synchronous');
			g.device.queue.submit([encoder.finish()]);
			return tick();
		};
		for (let index = 0; index < 30; index++) await draw();
		const waitsBefore = control.queueWaits;
		const queriesBefore = control.queries;
		control.holdReadbacks = true;
		control.gpuTimeMs = 600;
		const periodic = draw();
		assert.equal(control.pending.length, 1);
		control.gpuTimeMs = 1;
		const next = draw();
		assert.equal(control.queueWaits, waitsBefore, 'do not wait for GPU completion to monitor an ordinary frame');
		assert.equal(control.queries - queriesBefore, collectStatistics ? 2 : 1, 'statistics and monitoring share each measured pass');
		control.holdReadbacks = false;
		for (const readback of control.pending) readback.resolve();
		await Promise.all([periodic, next]); await tick();
		assert.equal(renderer.shouldTile(), true, 'the expensive asynchronous result changes the next render plan');
	});
}

// 【履歴リセット後に古い定期計測が返っても、新しい学習結果へ混ぜない】
// 計測バッファを解放して古いmapAsyncが失敗する場合も、未処理の拒否や通常描画の解除を残さない。
test('ignores periodic GPU results after resetting an effect instance', async t => {
	const g = gpu();
	const control = enableAsynchronousTimestampGpu(t, g);
	const renderer = passExecution(t, g);
	assert.equal(renderer.shouldTile(), true);
	await renderer.renderTiled(frame, new AbortController().signal);
	for (let index = 0; index < 31; index++) {
		if (index === 30) { control.holdReadbacks = true; control.gpuTimeMs = 1000; }
		assert.equal(renderer.shouldTile(), false);
		const encoder = g.device.createCommandEncoder();
		renderer.record(frame, encoder);
		g.device.queue.submit([encoder.finish()]);
	}
	assert.equal(control.pending.length, 1);
	renderer.reset();
	control.holdReadbacks = false; control.gpuTimeMs = 1;
	assert.equal(renderer.shouldTile(), true);
	await renderer.renderTiled(frame, new AbortController().signal); await tick();
	assert.equal(renderer.shouldTile(), false);
	for (const readback of control.pending) readback.resolve();
	await tick();
	assert.equal(renderer.shouldTile(), false);
});



const image = { dataType: { kind: 'color' }, ui: { label: 'Image', control: {} }, canNode: true, defaultValue: [0, 0, 0, 0] };
const sampling = { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' };
const wire = nodeId => ({ inputSource: 'node', source: { nodeId, outputPort: 'output' }, sampling });
const node = (id, params = {}) => ({ id, params, effectSource: { type: 'nativeEffect', id } });
async function tiledGraph(g, nodes, tiling, { heavy, init, onGpuTime, onFrameGpuTime } = {}) {
	const metadata = { paramDefs: { left: image, right: image }, resolutionInputParameters: [], primaryInputParameter: 'left',
		primaryOutput: 'output', outputDefs: { output: { dataType: { kind: 'color' } } } };
	const graph = { ...metadata, nodes, outputSources: { output: { nodeId: nodes.at(-1).id, outputPort: 'output' } } };
	const renders = [], hints = [];
	const instance = await createEffectInstance({ effectSource: { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph },
		definitions: { getNativeEffect: id => ({ ...metadata, canHaveLongRunningRenderPass: id === heavy }) }, resolution: { width: 16, height: 9 },
		usedOutputPorts: new Set(['output']), tiling, onGpuTime, onFrameGpuTime }, g.wgpu, id => ({
			createOutputTexture: (port, size, { device }) => device.createTexture({ size, port, format: 'rgba16float' }),
			init(context, publishers) {
				const view = context.outputTextures.get('output').createView();
				return { cacheKey: 0, dispose() {}, getRenderWorkloadHint() { hints.push(id); return { key: id, workPerPixel: 1 }; },
					render({ commandEncoder }) {
						renders.push(id);
						const pass = commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] });
						pass.draw(3); pass.end();
					}, ...init?.(context, publishers) };
			},
		}));
	return { instance, renders, hints };
}

// 【統計の読み戻しが終わる前に通常描画を返す】
// プレビューの応答時間をGPUのタイムスタンプ読み出しへ結び付けない。
test('finishes an untiled graph frame before its GPU statistics readback completes', async t => {
	const g = gpu(), control = enableAsynchronousTimestampGpu(t, g), reports = [], frameReports = [];
	const f = await tiledGraph(g, [node('effect')], { mode: 'disabled' }, {
		onGpuTime: (...args) => reports.push(args), onFrameGpuTime: (...args) => frameReports.push(args),
	});
	t.after(() => f.instance.dispose());
	control.holdReadbacks = true;
	await f.instance.renderTiled(frame);
	assert.equal(control.pending.length, 1); assert.deepEqual(reports, []);
	assert.equal(frameReports.length, 1);
	assert.equal(frameReports[0][0], frame);
	control.pending[0].resolve(); await tick();
	assert.deepEqual(reports, [[['effect'], 0, 1]]);
	assert.equal(await frameReports[0][1], 1);
});

// 【通常パスとタイルのGPU時間を同じフレームに合計する】
// 途中の送信境界でフレームが分かれたり、同じ描画で計測用Queryが二重に発行されたりしない。
test('sums ordinary and tiled passes into one GPU time per frame', async t => {
	const g = gpu(), control = enableAsynchronousTimestampGpu(t, g);
	const frameReports = [], passReports = [];
	const f = await tiledGraph(g, [node('first'), node('heavy', { left: wire('first') }), node('last', { left: wire('heavy') })], { mode: 'auto' }, {
		heavy: 'heavy',
		onGpuTime: (path, index, milliseconds) => passReports.push([path[0], index, milliseconds]),
		onFrameGpuTime: (...args) => frameReports.push(args),
	});
	t.after(() => f.instance.dispose());
	await f.instance.renderTiled(frame);
	assert.equal(frameReports.length, 1);
	assert.equal(await frameReports[0][1], 3);
	assert.deepEqual(passReports.toSorted((a, b) => a[0].localeCompare(b[0])), [['first', 0, 1], ['heavy', 0, 1], ['last', 0, 1]]);
	assert.equal(control.queries, 3);

	const cachedFrame = { ...frame, time: 1 };
	await f.instance.renderTiled(cachedFrame);
	assert.equal(frameReports.length, 2);
	assert.equal(frameReports[1][0], cachedFrame);
	assert.equal(await frameReports[1][1], 0);
	assert.equal(control.queries, 3);
});

// 【タイルの計測失敗で完成画像を破棄しない】
// 一部のQueryを読み戻せなければ合計値は不明として扱う。次のキャッシュ再利用は0として記録する。
test('reports an unavailable frame time when one tile timestamp readback fails', async t => {
	const g = gpu(), control = enableAsynchronousTimestampGpu(t, g);
	const frameReports = [];
	const f = await tiledGraph(g, [node('effect')], { mode: 'manual', tileSize: 8 }, {
		onFrameGpuTime: (_frame, result) => frameReports.push(result),
	});
	t.after(() => f.instance.dispose());
	control.failNextReadback = true;
	await f.instance.renderTiled(frame);
	assert.equal(frameReports.length, 1);
	assert.equal(await frameReports[0], null);
	assert.equal(control.queries, 4);
	await f.instance.renderTiled({ ...frame, time: 1 });
	assert.equal(frameReports.length, 2);
	assert.equal(await frameReports[1], 0);
	assert.deepEqual(f.renders, ['effect']);
});

// 【共有された上流ツリーは全タイルの完了後に一度だけ公開する】
// 後段は上流の未完成な画像を読まず、同じフレームを再度表示するときはGPUへ再送信しない。
test('renders tiled graph dependencies once and caches only completed work', async t => {
	const g = gpu(), control = enableControlledTiledGpu(g);
	const f = await tiledGraph(g, [node('a'), node('b', { left: wire('a'), right: wire('a') })], { mode: 'manual', tileSize: 8 });
	t.after(() => f.instance.dispose());
	const running = f.instance.renderTiled(frame); await tick();
	assert.deepEqual(f.renders, ['a']);
	for (let i = 0; i < 4; i++) await control.finish();
	assert.deepEqual(f.renders, ['a', 'b']);
	for (let i = 0; i < 4; i++) await control.finish();
	assert.equal(await running, undefined);
	await f.instance.renderTiled(frame);
	assert.equal(control.submissions.length, 8); assert.deepEqual(f.renders, ['a', 'b']);
});

// 【送信したタイルが完了するまで履歴画像の解放を待つ】
// 中断した描画で履歴を進めず、GPUが使用中のテクスチャを早期に破棄しない。
test('defers disposal of a cancelled tiled placement until submitted work drains', async () => {
	const g = gpu(), control = enableControlledTiledGpu(g);
	const f = await tiledGraph(g, [node('history')], { mode: 'manual', tileSize: 8 });
	const running = assert.rejects(f.instance.renderTiled(frame), { name: 'AbortError' });
	await tick(); assert.ok(control.submissions.length > 0);
	f.instance.dispose(); assert.ok(g.textures.every(texture => texture.destroyed === 0));
	while (control.waits.length > 0) await control.finish();
	await running;
	assert.ok(g.textures.every(texture => texture.destroyed === 1));
});

// 【軽量なNative Effectの通常描画はヒントを問い合わせない】
// 自動分割を有効にしたグラフでも、対象外のEffectに計測や追加送信の費用を負わせない。
test('keeps ordinary effects synchronous without consulting workload hints', async t => {
	const g = gpu(), f = await tiledGraph(g, [node('ordinary')], { mode: 'auto' });
	t.after(() => f.instance.dispose());
	assert.equal(f.instance.render(frame, g.encoder), undefined); assert.deepEqual(f.renders, ['ordinary']); assert.deepEqual(f.hints, []);
});

// 【自動分割の前後にある通常ノードをまとめて送信する】
// タイル対象の前後関係を保ちつつ、通常ノードごとにGPU完了を待たない。
test('batches ordinary nodes around an automatic effect without timestamp queries', async t => {
	const g = gpu(), control = enableControlledTiledGpu(g);
	const ids = ['first', 'second', 'heavy', 'last'];
	const f = await tiledGraph(g, ids.map((id, i) => node(id, i === 0 ? {} : { left: wire(ids[i - 1]) })), { mode: 'auto' }, { heavy: 'heavy' });
	t.after(() => f.instance.dispose());
	const running = f.instance.renderTiled(frame); await tick();
	assert.equal(control.submissions.length, 1); assert.deepEqual(f.renders, ids.slice(0, 3));
	await control.finish(); await control.finish(); await running;
	assert.equal(control.submissions.length, 3); assert.deepEqual(f.hints, ['heavy']); assert.deepEqual(f.renders, ids);
});

// 【軽い描画は通常経路に戻し、一定フレーム後に再計測する】
// timestamp-queryのない環境も一度の計測に固定せず、次の負荷変化を検出する。
test('returns a measured light effect to ordinary rendering and periodically measures again', async t => {
	const g = gpu(), control = enableControlledTiledGpu(g);
	const execution = passExecution(t, g); t.mock.method(performance, 'now', () => 0);
	assert.equal(execution.shouldTile(), true);
	const running = execution.renderTiled(frame, new AbortController().signal);
	await control.finish(); await control.finish(); await running;
	for (let index = 0; index < 30; index++) {
		assert.equal(execution.shouldTile(), false); execution.record(frame, g.device.createCommandEncoder());
	}
	assert.equal(execution.shouldTile(), true);
});
