import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutText } from '../src/text-rendering/text-layout.ts';
import { measureTextInkBounds } from '../src/text-rendering/text-bounds.ts';

function measure(text, size) {
	return {
		width: text.length * size, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * size,
		actualBoundingBoxAscent: size * 0.8, actualBoundingBoxDescent: size * 0.2,
		fontBoundingBoxAscent: size * 0.8, fontBoundingBoxDescent: size * 0.2,
	};
}

// 【縦書きの文字と輪郭を囲う矩形も描画と同じ向きへ回す】
// Timelineは文字の周囲だけのテクスチャを作るため、横組みの矩形を使うと縦書きが欠ける。
// 改行で左へ送られた列と、文字送り方向だけの圧縮を含む実際の範囲を保持する。
test('rotates outlined and compressed vertical ink bounds into canvas coordinates', () => {
	for (const [overflow, expected] of [
		['none', { left: -120, right: 120, top: -10, bottom: 210 }],
		['compress', { left: -120, right: 120, top: -5, bottom: 105 }],
		['shrink', { left: -60, right: 60, top: -5, bottom: 105 }],
	]) {
		const layout = layoutText({ writingMode: 'vertical-rl', text: '日本\n語', fontSize: 100,
			outlineWidth: 0.1, lineHeight: 1.2, alignment: 'left', overflow, maxInlineSize: 110 }, measure);
		const bounds = measureTextInkBounds(layout, () => assert.fail('Vertical ink was already measured during layout'));
		assert.deepEqual(bounds, expected);
	}
});

// 【空の縦書きには画素のある矩形を生成しない】
// 空列の行送りはレイアウトに必要だが、描画範囲を無駄に確保したり、
// InfinityをCanvasやGPUの寸法へ渡したりする原因にしてはいけない。
test('returns no ink for blank vertical columns', () => {
	const layout = layoutText({ writingMode: 'vertical-rl', text: '\n', fontSize: 100,
		outlineWidth: 0.1, lineHeight: 1.2, alignment: 'left', overflow: 'none', maxInlineSize: 100 }, measure);
	assert.equal(measureTextInkBounds(layout, () => assert.fail('Blank columns have no ink')), null);
});
