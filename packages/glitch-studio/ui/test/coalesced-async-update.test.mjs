import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/utility/coalesced-async-update.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { CoalescedAsyncUpdate } = module.exports;

// 【連続操作は最新値へまとめ、処理中は次の一件だけを保留して確定値を直ちに反映する】
// GPU完了が遅くてもRPCを積み重ねず、ドラッグ終了時に最後の設定を取りこぼさない。
test('coalesces updates and flushes the final state without overlapping requests', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const calls = [];
	let value = 0;
	const queue = new CoalescedAsyncUpdate(() => { const completion = Promise.withResolvers(); calls.push({ value, ...completion }); return completion.promise; }, error => { throw error; });
	t.after(() => queue.clear());
	value = 1; queue.request(); value = 2; queue.request();
	t.mock.timers.tick(99);
	assert.equal(calls.length, 0);
	t.mock.timers.tick(1);
	assert.equal(calls[0].value, 2);
	value = 3; queue.request(); value = 4; queue.request(); queue.flush();
	t.mock.timers.tick(1000);
	assert.equal(calls.length, 1);
	calls[0].resolve();
	await setImmediate();
	assert.equal(calls.length, 2);
	assert.equal(calls[1].value, 4);
	calls[1].resolve();
	await setImmediate();
});

// 【Workerの破棄では保留を消し、古い失敗を復旧後のエラーとして扱わない】
// 実行中の処理は直列のまま、新しい世代の要求だけを続けられることを確認する。
test('clears pending work and ignores failures from an obsolete request', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const errors = [];
	const calls = [];
	const queue = new CoalescedAsyncUpdate(() => { const completion = Promise.withResolvers(); calls.push(completion); return completion.promise; }, error => errors.push(error));
	t.after(() => queue.clear());
	queue.request(); queue.clear(); t.mock.timers.tick(100);
	assert.equal(calls.length, 0);
	queue.request(); queue.flush(); queue.clear(); queue.request(); queue.flush();
	assert.equal(calls.length, 1);
	calls[0].reject(new Error('old worker'));
	await setImmediate();
	assert.deepEqual(errors, []);
	assert.equal(calls.length, 2);
	calls[1].resolve();
	await setImmediate();
});
