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
		t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
	}
	return { loads, fonts };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

// 【フォントの準備を待ち、中断後も同じ読み込みを次の描画で使う】
// 書き出しの最初のフレームが代替フォントになることや、シークで読み込みを繰り返すことを防ぐ。
test('waits for fonts and reuses an in-flight load after cancellation', async t => {
	const { loads, fonts } = fixture(t);
	const loader = createTextFontLoader();
	const blob = new Blob(['font']);
	const controller = new AbortController();
	const cancelled = loader.prepare(blob, controller.signal);
	await flush();
	assert.equal(fonts.size, 0);
	controller.abort();
	assert.equal(await cancelled, false);
	const pending = loader.prepare(blob, new AbortController().signal);
	assert.equal(loads.length, 1);
	loads[0].resolve();
	assert.equal(await pending, true);
	assert.equal(fonts.size, 1);
	assert.match(loader.family, /^GlitchTimelineTextFont/);
	loader.dispose();
	assert.equal(fonts.size, 0);
});

// 【フォント変更・破棄より古い非同期結果を登録しない】
// 別クリップのフォントへ戻る競合と、区間外へシークした後のFontFaceSetへのリークを防ぐ。
test('discards replaced and disposed loads and releases registered fonts', async t => {
	const { loads, fonts } = fixture(t);
	const loader = createTextFontLoader();
	const first = loader.prepare(new Blob(['first']), new AbortController().signal);
	await flush();
	const second = loader.prepare(new Blob(['second']), new AbortController().signal);
	await flush();
	loads[0].resolve();
	assert.equal(await first, false);
	assert.equal(fonts.size, 0);
	loads[1].resolve();
	assert.equal(await second, true);
	assert.equal(fonts.size, 1);
	assert.equal(await loader.prepare(null, new AbortController().signal), true);
	assert.equal(fonts.size, 0);
	assert.equal(loader.family, 'sans-serif');
	const third = loader.prepare(new Blob(['third']), new AbortController().signal);
	await flush();
	loader.dispose();
	loads[2].resolve();
	assert.equal(await third, false);
	assert.equal(fonts.size, 0);
});

// 【無効なフォントの失敗を呼び出し元へ伝える】
// 書き出しを代替フォントで黙って続けず、既存のタイムラインエラー表示へ到達させる。
test('propagates font loading failures', async t => {
	const { loads } = fixture(t);
	const loader = createTextFontLoader();
	const pending = loader.prepare(new Blob(['invalid']), new AbortController().signal);
	const rejected = assert.rejects(pending, /invalid font/);
	await flush();
	loads[0].reject(new Error('invalid font'));
	await rejected;
	loader.dispose();
});
