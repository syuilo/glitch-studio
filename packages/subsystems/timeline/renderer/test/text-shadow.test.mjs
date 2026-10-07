import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTextShadowMetrics } from '../src/layers/text/text-shadow.ts';

// 【影の移動量とぼかし幅を、縮小後の文字サイズから求める】
// フォント縮小や書き出し倍率に追従させるため、固定pxや縮小前のSizeからは求めない。
// +Yが上というアプリ側の指定を、Canvasの下向き座標へ一度だけ変換する。
test('uses the effective font size and converts upward offsets to canvas coordinates', () => {
	const settings = { blur: 0.1, offset: [0.2, 0.3] };
	const original = getTextShadowMetrics(settings, 100);
	const shrunk = getTextShadowMetrics(settings, 50);
	assert.equal(original.blur, 10);
	assert.equal(original.offsetX, 20);
	assert.equal(original.offsetY, -30);
	assert.equal(shrunk.blur, 5);
	assert.equal(shrunk.offsetX, 10);
	assert.equal(shrunk.offsetY, -15);
});

// 【ぼかしなしでも、移動した輪郭の明瞭な影を作れる】
// 有効・無効はDrop shadowの設定で決まり、blur=0は無効化を意味しない。
// 負のぼかし幅も0に丸め、以前のCanvasフィルターが残る原因にしない。
test('keeps a sharp offset shadow when blur is zero or negative', () => {
	for (const blur of [0, -0.1]) {
		assert.deepEqual(getTextShadowMetrics({ blur, offset: [-0.2, -0.3] }, 100), {
			blur: 0, offsetX: -20, offsetY: 30, padding: 0,
		});
	}
});

// 【ぼかしのための余白を確保し、大きな移動量だけでCanvasを巨大化させない】
// 影の位置へ字形を描いてからぼかすので、必要な余白は移動距離によらない。
// 画面外の字形がぼかしを通して画面内に寄与する範囲を保持する。
test('reserves blur padding independently of shadow displacement', () => {
	const original = getTextShadowMetrics({ blur: 0.15, offset: [0, 0] }, 100);
	const distant = getTextShadowMetrics({ blur: 0.15, offset: [1000, -1000] }, 100);
	assert.ok(Number.isInteger(original.padding));
	assert.ok(original.padding >= original.blur * 3);
	assert.equal(distant.padding, original.padding);
});

// 【式からの非有限値をCanvasのフィルターや座標へ渡さない】
// 無効なfilterやtransformの代入は以前の状態を残し得るため、影だけを描画なしにする。
// フォントと設定が有限でも、pxへの変換で溢れる場合を含めて弾く。
test('rejects invalid sizes, offsets and blur dimensions', () => {
	const settings = { blur: 0.1, offset: [0.2, -0.2] };
	for (const fontSize of [0, -1, NaN, Infinity]) assert.equal(getTextShadowMetrics(settings, fontSize), null);
	for (const invalid of [NaN, Infinity, Number.MAX_VALUE]) {
		assert.equal(getTextShadowMetrics({ ...settings, blur: invalid }, 100), null);
		assert.equal(getTextShadowMetrics({ ...settings, offset: [invalid, 0] }, 100), null);
		assert.equal(getTextShadowMetrics({ ...settings, offset: [0, invalid] }, 100), null);
	}
});
