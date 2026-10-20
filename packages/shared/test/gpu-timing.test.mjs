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
