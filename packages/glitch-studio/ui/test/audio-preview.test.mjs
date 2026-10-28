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

// 【保存済みのAnalyze無効状態でパネルを追加しても、解析・描画を始めずメーターは継続する】
// 起動後に一度だけ描画してしまうのを防ぎ、停止のためにWorkerやCanvasを破棄しない。
// 音声再生の基本表示に必要なメーター通知は、モニター解析の無効化から独立させる。
test('initializes disabled analysis without suspending playback meters or recreating panels', async () => {
	const f = fixture();
	await f.preview.setAnalysisEnabled(false);
	assert.equal(f.workers.length, 0);
	f.preview.add(f.canvas, { mode: 'waveform', settings: { overlay: false, waveformSeconds: 0.04 } }, () => {});
	const worker = f.workers[0];
	assert.equal(f.preview.isAnalysisEnabled.value, false);
	assert.equal(f.preview.isRenderingSuspended.value, false);
	assert.equal(f.preview.isRenderingEnabled.value, false);
	assert.deepEqual(worker.messages[0].message, { type: 'renderingSuspended', suspended: true, requestId: null });
	const readings = [];
	f.preview.attachMeter({}, reading => readings.push(reading));
	const id = worker.messages.at(-1).message.id;
	const reading = { id, generation: 1, left: 0.5, right: 0.25 };
	worker.reply({ type: 'meters', readings: [reading] });
	assert.deepEqual(readings, [reading]);
	assert.deepEqual(worker.messages.at(-1).message, { type: 'metersReceived' });
	const enabled = f.preview.setAnalysisEnabled(true);
	worker.reply({ type: 'renderingStateApplied', requestId: worker.messages.at(-1).message.requestId });
	await enabled;
	assert.equal(f.preview.isRenderingEnabled.value, true);
	assert.equal(f.workers.length, 1);
	assert.equal(worker.terminated, false);
	assert.equal(f.transfers, 1);
});

// 【Analyzeと一時休止は互いの停止理由を解除せず、最後の状態をWorkerへ送る】
// 書き出し終了時のresumeでAnalyze無効を上書きしたり、休止中のAnalyze切り替えで
// 先に音声モニターだけが動き出したりすると、映像処理との競合が再発する。
test('combines analysis preferences and temporary suspension across interleaved changes', async () => {
	const f = fixture();
	f.preview.add(f.canvas, { mode: 'waveform', settings: { overlay: false, waveformSeconds: 0.04 } }, () => {});
	const worker = f.workers[0];
	async function apply(change, suspended) {
		const applied = change();
		const request = worker.messages.at(-1).message;
		assert.equal(request.suspended, suspended);
		worker.reply({ type: 'renderingStateApplied', requestId: request.requestId });
		await applied;
		assert.equal(f.preview.isRenderingEnabled.value, !suspended);
	}
	await apply(() => f.preview.setAnalysisEnabled(false), true);
	await apply(() => f.preview.setRenderingSuspended(true), true);
	await apply(() => f.preview.setRenderingSuspended(false), true);
	await apply(() => f.preview.setRenderingSuspended(true), true);
	await apply(() => f.preview.setAnalysisEnabled(true), true);
	await apply(() => f.preview.setRenderingSuspended(false), false);
});
