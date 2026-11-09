import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { PreviewBackgroundScheduler } = await loadShaderSource(fileURLToPath(new URL('../src/preview-background-scheduler.ts', import.meta.url)));
const { CpuPreviewFrameQueue } = await loadShaderSource(fileURLToPath(new URL('../src/cpu-preview-frame-queue.ts', import.meta.url)));

const flush = () => new Promise(resolve => setImmediate(resolve));

// 【通常の描画中と非表示中には背景だけの描画を追加しない】
// 定期タイマーを単に間引くのでは、再生中の最終表示が重複し、切替前のWorkerも描画し続ける。
// 通常フレームが途切れたときだけ背景を更新し、表示を外した瞬間に予約を取り消す。
test('renders backgrounds only while the active preview is idle', async t => {
	let renders = 0;
	const scheduler = new PreviewBackgroundScheduler(async () => { renders++; });
	t.mock.timers.enable({ apis: ['setTimeout'] });
	t.after(() => scheduler.setEnabled(false));
	t.mock.timers.tick(100);
	assert.equal(renders, 0);
	scheduler.setEnabled(true);
	for (let frame = 0; frame < 10; frame++) {
		t.mock.timers.tick(16);
		scheduler.notifyFrameRendered();
	}
	assert.equal(renders, 0);
	t.mock.timers.tick(34);
	await flush();
	assert.equal(renders, 1);
	scheduler.setEnabled(false);
	t.mock.timers.tick(1000);
	await flush();
	assert.equal(renders, 1);
	scheduler.setEnabled(true);
	t.mock.timers.tick(34);
	await flush();
	assert.equal(renders, 2);
});

// 【GPU待機中に背景要求を積み増さず、旧表示の失敗で新しい表示を停止しない】
// 非表示・再表示がGPU完了より先に起きても、古いPromiseの終了から現在の状態を再開する。
test('keeps one background render in flight across preview switches', async t => {
	const first = Promise.withResolvers();
	let renders = 0;
	const scheduler = new PreviewBackgroundScheduler(() => ++renders === 1 ? first.promise : Promise.resolve());
	t.mock.timers.enable({ apis: ['setTimeout'] });
	t.after(() => scheduler.setEnabled(false));
	scheduler.setEnabled(true);
	t.mock.timers.tick(34);
	t.mock.timers.tick(1000);
	assert.equal(renders, 1);
	scheduler.setEnabled(false);
	scheduler.setEnabled(true);
	first.reject(new Error('obsolete display'));
	await flush();
	t.mock.timers.tick(34);
	await flush();
	assert.equal(renders, 2);
});

// 【背景更新は主画像だけを読み戻し、通常描画と同じ二つの待機枠を使う】
// 解析画像を転送しない変更で、別のキューを作って転送上限まで増やすことを防ぐ。
test('reserves only the updated canvas without increasing CPU frame capacity', async () => {
	const copied = [];
	const contexts = ['main', 'histogram', 'horizontal', 'vertical'].map(name => ({
		prepareReadback(_encoder, release) {
			copied.push(name);
			return { complete: async () => release(), cancel() {} };
		},
	}));
	const queue = new CpuPreviewFrameQueue(contexts);
	const background = queue.tryReserveFrame([contexts[0]]);
	const normal = queue.tryReserveFrame();
	assert.equal(queue.tryReserveFrame(), null);
	background.prepareReadback({});
	assert.deepEqual(copied, ['main']);
	await background.complete();
	const nextNormal = queue.tryReserveFrame();
	assert.notEqual(nextNormal, null);
	normal.prepareReadback({});
	assert.deepEqual(copied, ['main', 'main', 'histogram', 'horizontal', 'vertical']);
	queue.destroy();
});
