import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { i18nPlugin } from './helpers/i18n.mjs';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/HighResolutionImageAnalysisController.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'], plugins: [i18nPlugin] });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { HighResolutionImageAnalysisController } = module.exports;

const settings = maximum => ({ target: 'vectorX', imageSource: 'original', imageAdjustments: { exposure: 0, srgbProof: false, gamutCompression: { mode: 'none', customAmount: 0.5 } }, valueScale: 'linear', valueRange: { minimum: 0, maximum }, waveformCanvasSizes: null, waveformViewports: null, histogramViewport: null });
function fixture(t, { delayed = false, captured = true } = {}) {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const calls = [];
	const pauses = [];
	const errors = [];
	let refreshes = 0;
	const source = { setHighResolutionImageAnalysis(enabled, value) {
		const completion = Promise.withResolvers();
		calls.push({ enabled, settings: structuredClone(value), ...completion });
		if (!delayed || !enabled) completion.resolve(captured);
		return completion.promise;
	} };
	const controller = new HighResolutionImageAnalysisController({
		async setLivePaused(value) { pauses.push(value); },
		refreshLive() { refreshes++; }, onError(error) { errors.push(error); },
	});
	t.after(() => controller.reset());
	return { controller, source, calls, pauses, errors, get refreshes() { return refreshes; } };
}

// 【保持元を一度確定し、無操作中は追加の解析要求を送らない】
// 通常の再生に解析が追従しないことと、オフで通常解析の休止を解除することを確認する。
test('holds the selected preview without periodic analysis and resumes live analysis when disabled', async t => {
	const f = fixture(t);
	await f.controller.enable(f.source, settings(1));
	assert.equal(f.controller.source.value, f.source);
	assert.equal(f.controller.active.value, true);
	assert.equal(f.controller.busy.value, false);
	t.mock.timers.tick(10000);
	assert.equal(f.calls.length, 1);
	await f.controller.disable();
	assert.deepEqual(f.pauses, [true, false]);
	assert.deepEqual(f.calls.map(call => call.enabled), [true, false]);
	assert.equal(f.controller.active.value, false);
	assert.equal(f.controller.source.value, null);
	assert.equal(f.refreshes, 1);
});

// 【ドラッグを100msで間引き、実行中は最新値だけを保留して確定値を必ず反映する】
// GPUが遅い間に要求を積み重ねず、結果が反映されるまでグラフの目盛りを変更しない。
test('coalesces pending settings and flushes the latest value after the in-flight analysis completes', async t => {
	const f = fixture(t, { delayed: true });
	const enabling = f.controller.enable(f.source, settings(1));
	f.calls[0].resolve(true);
	await enabling;
	f.controller.update(settings(2));
	f.controller.update(settings(3));
	t.mock.timers.tick(99);
	assert.equal(f.calls.length, 1);
	t.mock.timers.tick(1);
	assert.equal(f.calls.length, 2);
	assert.equal(f.calls[1].settings.valueRange.maximum, 3);
	assert.equal(f.controller.displayedSettings.value.valueRange.maximum, 1);
	f.controller.update(settings(4));
	f.controller.update(settings(5));
	f.controller.flush();
	assert.equal(f.calls.length, 2);
	f.calls[1].resolve(true);
	await setImmediate();
	assert.equal(f.calls.length, 3);
	assert.equal(f.calls[2].settings.valueRange.maximum, 5);
	assert.equal(f.controller.displayedSettings.value.valueRange.maximum, 3);
	f.calls[2].resolve(true);
	await setImmediate();
	assert.equal(f.controller.displayedSettings.value.valueRange.maximum, 5);
	assert.equal(f.controller.busy.value, false);
});

// 【取得中にオフにしても、遅れて届いた完了通知で保持表示を復活させない】
// WorkerのGPU完了は非同期なので、モードの世代をまたいだ応答を無視する必要がある。
test('ignores capture completion after disabling or resetting the session', async t => {
	const f = fixture(t, { delayed: true });
	const enabling = f.controller.enable(f.source, settings(1));
	await f.controller.disable();
	f.calls[0].resolve(true);
	await enabling;
	assert.equal(f.controller.active.value, false);
	assert.equal(f.controller.displayedSettings.value, null);
	const next = f.controller.enable(f.source, settings(2));
	f.controller.reset();
	f.calls.at(-1).resolve(true);
	await next;
	assert.equal(f.controller.source.value, null);
	assert.equal(f.controller.busy.value, false);
});

// 【元フレームがまだ存在しなければ通常表示へ戻し、再取得できる状態を保つ】
// 黙って次のフレームを保持するとオン時点の画像という意味が変わるため、取得失敗を明示する。
test('returns to live mode when no frame is available', async t => {
	const f = fixture(t, { captured: false });
	await f.controller.enable(f.source, settings(1));
	assert.equal(f.controller.active.value, false);
	assert.equal(f.controller.errorMessage.value, 'No preview frame available');
	assert.deepEqual(f.pauses, [true, false]);
	assert.equal(f.errors.length, 0);
});
