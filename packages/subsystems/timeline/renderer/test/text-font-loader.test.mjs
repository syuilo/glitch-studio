import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTextFontLoader } from '../src/text-rendering/text-font-loader.ts';

function fixture(t) {
	const loads = [];
	const fonts = new Set();
	for (const [key, value] of Object.entries({ fonts, FontFace: class {
		constructor(family) { this.family = family; }
		load() { return new Promise((resolve, reject) => loads.push({ resolve: () => resolve(this), reject })); }
	} })) {
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
		Object.defineProperty(globalThis, key, { configurable: true, value });
		t.after(() => { if (descriptor != null) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
	}
	return { loads, fonts };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

// 【フォントの準備を待ち、中断後も同じ読み込みを次の描画で使う】
// 書き出しの最初のフレームが代替フォントになることや、シークで読み込みを繰り返すことを防ぐ。
test('waits for fonts and reuses an in-flight load after cancellation', async t => {
	const { loads, fonts } = fixture(t);
	const blob = new Blob(['font']);
	const loader = createTextFontLoader(blob);
	const controller = new AbortController();
	const cancelled = loader.waitUntilReady(controller.signal);
	await flush();
	assert.equal(fonts.size, 0);
	controller.abort();
	assert.equal(await cancelled, false);
	const pending = loader.waitUntilReady(new AbortController().signal);
	assert.equal(loads.length, 1);
	loads[0].resolve();
	assert.equal(await pending, true);
	assert.equal(fonts.size, 1);
	assert.match(loader.family, /^GlitchTimelineTextFont/);
	loader.dispose();
	assert.equal(fonts.size, 0);
});

// 【素材変更でローダーを作り直しても古いフォントを登録しない】
// 静的設定の変更とクリップ終了ではローダーを破棄するため、各寿命をまたいだFontFaceSetへのリークを防ぐ。
test('discards disposed loads and releases fonts when loaders are recreated', async t => {
	const { loads, fonts } = fixture(t);
	const firstLoader = createTextFontLoader(new Blob(['first']));
	const first = firstLoader.waitUntilReady(new AbortController().signal);
	await flush();
	firstLoader.dispose();
	const secondLoader = createTextFontLoader(new Blob(['second']));
	const second = secondLoader.waitUntilReady(new AbortController().signal);
	await flush();
	loads[0].resolve();
	assert.equal(await first, false);
	assert.equal(fonts.size, 0);
	loads[1].resolve();
	assert.equal(await second, true);
	assert.equal(fonts.size, 1);
	secondLoader.dispose();
	assert.equal(fonts.size, 0);
	const defaultLoader = createTextFontLoader(null);
	assert.equal(await defaultLoader.waitUntilReady(new AbortController().signal), true);
	assert.equal(defaultLoader.family, 'sans-serif');
	defaultLoader.dispose();
	const thirdLoader = createTextFontLoader(new Blob(['third']));
	const third = thirdLoader.waitUntilReady(new AbortController().signal);
	await flush();
	thirdLoader.dispose();
	loads[2].resolve();
	assert.equal(await third, false);
	assert.equal(fonts.size, 0);
});

// 【無効なフォントの失敗を呼び出し元へ伝える】
// 書き出しを代替フォントで黙って続けず、既存のタイムラインエラー表示へ到達させる。
test('propagates font loading failures', async t => {
	const { loads } = fixture(t);
	const loader = createTextFontLoader(new Blob(['invalid']));
	const pending = loader.waitUntilReady(new AbortController().signal);
	const rejected = assert.rejects(pending, /invalid font/);
	await flush();
	loads[0].reject(new Error('invalid font'));
	await rejected;
	loader.dispose();
});

// 【待機が中断済みかローダーが破棄済みならフォントを読み込まない】
// 未使用のクリップや古いシーク要求のために非同期処理を開始しないことを保証する。
test('does not start loading for cancelled or disposed waiters', async t => {
	const { loads } = fixture(t);
	const loader = createTextFontLoader(new Blob(['font']));
	const controller = new AbortController();
	controller.abort();
	assert.equal(await loader.waitUntilReady(controller.signal), false);
	loader.dispose();
	assert.equal(await loader.waitUntilReady(new AbortController().signal), false);
	await flush();
	assert.equal(loads.length, 0);
});
