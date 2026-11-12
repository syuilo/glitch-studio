import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/gpu/TimingHelper.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false });
function loadTimingHelper(globals = {}) {
	const module = { exports: {} };
	runInNewContext(bundle.outputFiles[0].text, { module, ...globals });
	return module.exports.default;
}

const tick = () => new Promise(resolve => setImmediate(resolve));

function asynchronousTimingFixture() {
	const TimingHelper = loadTimingHelper({ GPUBufferUsage: { QUERY_RESOLVE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8 }, GPUMapMode: { READ: 1 } });
	const buffers = [];
	const pending = [];
	let duration = 45n;
	const submitted = [];
	const device = {
		features: new Set(['timestamp-query']), queue: { submit: commands => submitted.push(...commands) },
		createQuerySet: ({ count }) => ({ timestamps: new BigUint64Array(count), destroy() {} }),
		createBuffer: ({ size }) => {
			const buffer = { size, data: new ArrayBuffer(size), destroyed: false,
				mapAsync: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
				getMappedRange() { if (this.destroyed) throw new Error('buffer disposed'); return this.data; },
				unmap() {}, destroy() { this.destroyed = true; } };
			buffers.push(buffer); return buffer;
		},
	};
	const encoder = () => ({
		beginRenderPass(descriptor) {
			const { querySet, beginningOfPassWriteIndex, endOfPassWriteIndex } = descriptor.timestampWrites;
			querySet.timestamps[beginningOfPassWriteIndex] = 100n;
			querySet.timestamps[endOfPassWriteIndex] = 100n + duration;
			return { end() {} };
		},
		resolveQuerySet(querySet, start, count, buffer, offset) { new BigUint64Array(buffer.data, offset).set(querySet.timestamps.subarray(start, start + count)); },
		copyBufferToBuffer(source, sourceOffset, target, targetOffset, size) { new Uint8Array(target.data, targetOffset, size).set(new Uint8Array(source.data, sourceOffset, size)); },
		finish: () => ({}),
	});
	return { helper: new TimingHelper(device), device, encoder, buffers, pending, submitted, duration: value => { duration = value; } };
}

// 【送信後にだけ自動readbackを始め、結果待ち中にも次の描画を送信できる】
// GPU完了待ちを定期計測へ残すと、軽い描画も一定間隔で引っ掛かる。結果の合計と
// 各パスの通知を共有し、送信側へPromiseの待機を要求しないことを確認する。
test('reads scheduled timestamps asynchronously after submission and shares per-pass results', async () => {
	const f = asynchronousTimingFixture();
	const encoder = f.encoder();
	const passes = [];
	const totals = [];
	f.helper.beginRenderPass(encoder, { colorAttachments: [] }, value => passes.push(value)).end();
	f.duration(91n);
	f.helper.beginRenderPass(encoder, { colorAttachments: [] }, value => passes.push(value)).end();
	f.helper.observeResult(value => totals.push(value));
	f.helper.readResultAfterSubmission();
	const commands = encoder.finish();
	assert.equal(f.pending.length, 0);
	f.device.queue.submit([commands]);
	assert.equal(f.pending.length, 1);
	assert.deepEqual(passes, []);
	f.device.queue.submit([{}]);
	assert.equal(f.submitted.length, 2);
	f.pending.shift().resolve(); await tick();
	assert.deepEqual(passes, [45, 91]);
	assert.deepEqual(totals, [136]);
	f.helper.dispose();
	assert.ok(f.buffers.every(buffer => buffer.destroyed));
});

// 【統計の既存getResultと制御用observerで、同じQueryの結果を二重に読み戻さない】
// GPU統計を有効にしたときだけ別のQueryや待機が増えることを防ぐ。
test('shares manually collected statistics with automatic measurement observers', async () => {
	const f = asynchronousTimingFixture();
	const encoder = f.encoder();
	const observations = [];
	f.helper.beginRenderPass(encoder, { colorAttachments: [] }, value => observations.push(['pass', value])).end();
	f.helper.observeResult(value => observations.push(['total', value]));
	f.device.queue.submit([encoder.finish()]);
	const result = f.helper.getResult();
	assert.equal(f.pending.length, 1);
	f.pending.shift().resolve();
	assert.equal(await result, 45);
	assert.deepEqual(observations, [['pass', 45], ['total', 45]]);
	f.helper.dispose();
});

// 【読み戻しの失敗・破棄を購読者へ通知し、滞留している全バッファを回収する】
// 後続フレームの結果が先に処理されても、古いmapAsyncの資源や未処理の拒否を残さない。
test('cancels failed and disposed readbacks without retaining pending buffers', async () => {
	for (const dispose of [false, true]) {
		const f = asynchronousTimingFixture();
		const values = [];
		for (let frame = 0; frame < 2; frame++) {
			const encoder = f.encoder();
			f.helper.beginRenderPass(encoder, { colorAttachments: [] }, value => values.push(value)).end();
			f.helper.observeResult(value => values.push(value));
			f.helper.readResultAfterSubmission();
			f.device.queue.submit([encoder.finish()]);
		}
		if (dispose) f.helper.dispose();
		for (const readback of f.pending.reverse()) {
			if (dispose) readback.resolve();
			else readback.reject(new Error('readback failed'));
		}
		await tick();
		assert.deepEqual(values, [null, null, null, null]);
		f.helper.dispose();
		assert.ok(f.buffers.every(buffer => buffer.destroyed));
	}
});

// 【計測ヘルパーのimportや非対応デバイスではGPUの送信処理を変更しない】
// プロトタイプを読み込み時に書き換えると、計測無効のプレビューや書き出しにも
// 全submitの配列化が残る。GPUQueueが存在しない環境でもimport自体には副作用を持たせない。
test('does not instrument GPU queues on import or without timestamp support', () => {
	const TimingHelper = loadTimingHelper();
	const queue = { submit() {} };
	const submit = queue.submit;
	new TimingHelper({ features: new Set(), queue });
	assert.equal(queue.submit, submit);
});

// 【計測するデバイスのqueueだけを一度ラップし、一度しか読めないコマンド列も送信する】
// プロトタイプの変更は他デバイスへ波及し、二重ラップは計測負荷を増やす。
// submitに渡したgeneratorが追跡のために先に消費され、GPUへ空の列を渡す回帰も防ぐ。
test('tracks only the measured queue once and preserves single-use command iterables', () => {
	const TimingHelper = loadTimingHelper();
	const submitted = [];
	class Queue { submit(buffers) { submitted.push([...buffers]); } }
	const originalSubmit = Queue.prototype.submit;
	const measured = new Queue();
	const unmeasured = new Queue();
	const device = { features: new Set(['timestamp-query']), queue: measured };
	new TimingHelper(device);
	const instrumentedSubmit = measured.submit;
	new TimingHelper(device);
	assert.equal(measured.submit, instrumentedSubmit);
	assert.equal(Queue.prototype.submit, originalSubmit);
	assert.equal(unmeasured.submit, originalSubmit);
	const command = {};
	let reads = 0;
	measured.submit((function* () { reads++; yield command; })());
	assert.equal(reads, 1);
	assert.deepEqual(submitted, [[command]]);
});

// 【デバイス単位のsubmit追跡でも未送信の読み戻しを拒否し、送信後はクエリ結果を取得する】
// ラップ対象をプロトタイプからqueueへ移したことで送信完了の記録を失うと、
// 有効化後の計測が失敗する。実GPUの代わりにクエリの解決・コピーだけを再現する。
test('reads timestamp results only after the measured command buffer is submitted', async () => {
	const TimingHelper = loadTimingHelper({ GPUBufferUsage: { QUERY_RESOLVE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8 }, GPUMapMode: { READ: 1 } });
	const device = {
		features: new Set(['timestamp-query']), queue: { submit() {} },
		createQuerySet: () => ({ timestamps: new BigUint64Array([100n, 145n]) }),
		createBuffer: ({ size }) => ({ size, data: new ArrayBuffer(size),
			async mapAsync() {}, getMappedRange() { return this.data; }, unmap() {} }),
	};
	const encoder = {
		beginRenderPass(descriptor) { assert.ok(descriptor.timestampWrites); return { end() {} }; },
		resolveQuerySet(querySet, start, count, buffer, offset) {
			new BigUint64Array(buffer.data, offset).set(querySet.timestamps.subarray(start, start + count));
		},
		copyBufferToBuffer(source, sourceOffset, target, targetOffset, size) {
			new Uint8Array(target.data, targetOffset, size).set(new Uint8Array(source.data, sourceOffset, size));
		},
		finish: () => ({}),
	};
	const helper = new TimingHelper(device);
	helper.beginRenderPass(encoder, { colorAttachments: [] }).end();
	const commandBuffer = encoder.finish();
	await assert.rejects(helper.getResult(), /must submit the command buffer/);
	device.queue.submit([commandBuffer]);
	assert.equal(await helper.getResult(), 45);
	assert.equal(await helper.getResult(), 0);
});
