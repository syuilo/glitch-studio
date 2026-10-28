import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
	entryPoints: [fileURLToPath(new URL('../src/audio/audio-preview.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	define: { 'import.meta.url': JSON.stringify(new URL('../src/audio/audio-preview.ts', import.meta.url).href) },
});

function fixture() {
	const workers = [];
	class Worker {
		messages = [];
		terminated = false;
		constructor() { workers.push(this); }
		postMessage(message, transfer) { this.messages.push({ message, transfer }); }
		terminate() { this.terminated = true; }
		reply(data) { this.onmessage({ data }); }
	}
	const module = { exports: {} };
	new Function('require', 'module', 'exports', 'Worker', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, Worker);
	const preview = new module.exports.AudioPreview();
	let transfers = 0;
	const offscreen = {};
	const canvas = { transferControlToOffscreen() { transfers++; return offscreen; } };
	return { preview, workers, canvas, offscreen, get transfers() { return transfers; } };
}

// 【休止中に追加したモニターも描画を始めず、復帰までCanvasの転送・設定を保持する】
// 書き出し中のパネル追加や別画面への配置で休止状態が失われないようにする。
// Workerの終了・Canvasの再転送で休止を実装すると、元のパネルへ安全に復帰できなくなる。
test('preserves panels and waits for rendering state acknowledgements', async () => {
	const f = fixture();
	await f.preview.setRenderingSuspended(true);
	assert.equal(f.workers.length, 0);
	const panel = f.preview.add(f.canvas, { mode: 'waveform', settings: { overlay: false, waveformSeconds: 0.04 } }, () => {});
	const worker = f.workers[0];
	assert.deepEqual(worker.messages[0].message, { type: 'renderingSuspended', suspended: true, requestId: null });
	assert.equal(worker.messages[1].transfer[0], f.offscreen);
	panel.configure({ mode: 'spectrum', settings: { overlay: true, waveformSeconds: 0.04 } });
	let applied = false;
	const resumed = f.preview.setRenderingSuspended(false).then(() => { applied = true; });
	await Promise.resolve();
	assert.equal(applied, false);
	const request = worker.messages.at(-1).message;
	worker.reply({ type: 'renderingStateApplied', requestId: request.requestId });
	await resumed;
	assert.equal(f.preview.isRenderingSuspended.value, false);
	assert.equal(worker.terminated, false);
	assert.equal(f.workers.length, 1);
	assert.equal(f.transfers, 1);
});

// 【音声モニターの失敗や破棄によって書き出し開始の確認待ちを残さない】
// モニターが動作できない状態では既に描画が止まっている。復帰不能なWorkerの応答を
// 待ち続けて、無関係な映像書き出しまで停止するのを防ぐ。
test('settles pending and future rendering requests after worker failure or disposal', async () => {
	for (const failure of ['error', 'dispose']) {
		const f = fixture();
		f.preview.add(f.canvas, { mode: 'waveform', settings: { overlay: false, waveformSeconds: 0.04 } }, () => {});
		const pending = f.preview.setRenderingSuspended(true);
		if (failure === 'error') f.workers[0].onerror({ message: 'Worker failed' });
		else f.preview.dispose();
		await pending;
		await f.preview.setRenderingSuspended(false);
	}
});
