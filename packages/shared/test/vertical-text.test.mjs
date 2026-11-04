import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutVerticalTextLine, drawVerticalTextLine } from '../src/text/vertical-text.ts';

function measure(text) {
	const width = Array.from(text).length * 100;
	return {
		width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width,
		actualBoundingBoxAscent: 80, actualBoundingBoxDescent: 20,
		fontBoundingBoxAscent: 80, fontBoundingBoxDescent: 20,
	};
}

// 【日本語は正立し、英数字は連続したまとまりで横倒しにする】
// 一文字ずつ回転するとカーニングや合字が失われる。括弧と長音符は回転し、
// 全角英数字・絵文字・補助漢字はUnicodeの縦書き向きに従って正立させる。
test('keeps upright graphemes and shapes consecutive sideways characters together', () => {
	const result = layoutVerticalTextLine('縦AV 123書「きー」Ａ😀𠮷', 100, 'left', measure);
	assert.deepEqual(result.runs.map(({ text, upright }) => [text, upright]), [
		['縦', true], ['AV 123', false], ['書', true], ['「', false],
		['き', true], ['ー」', false], ['Ａ', true], ['😀', true], ['𠮷', true],
	]);
});

// 【結合文字・異体字セレクタ・絵文字の連結を分断しない】
// UTF-16コード単位やコードポイント単位で配置すると、濁点や家族絵文字を別の枠へ
// 送ってしまう。表示上の一文字を一つの正立する枠で扱う必要がある。
test('preserves combining marks, variation selectors and joined emoji in one cell', () => {
	const result = layoutVerticalTextLine('か\u3099葛\u{E0100}👨‍👩‍👧', 100, 'left', measure);
	assert.deepEqual(result.runs.map(run => run.text), ['か\u3099', '葛\u{E0100}', '👨‍👩‍👧']);
	assert.equal(result.metrics.width, 300);
});

// 【短い列も上・中央・下を同じ基準点へ揃える】
// 列ごとに長さが異なる場合に揃える軸は文字送り方向であり、列の左右位置ではない。
// Canvas側のtextAlignで計測した値を戻してから、列全体の揃え位置を一度だけ適用する。
test('aligns the inline advance independently of canvas measurement alignment', () => {
	for (const [alignment, fraction] of [['left', 0], ['center', 0.5], ['right', 1]]) {
		const result = layoutVerticalTextLine('日AB', 100, alignment, text => {
			const metrics = measure(text);
			return { ...metrics, actualBoundingBoxLeft: metrics.width * fraction, actualBoundingBoxRight: metrics.width * (1 - fraction) };
		});
		assert.equal(result.metrics.width, 300);
		assert.equal(result.runs[1].x, 100 - 300 * fraction);
		assert.equal(result.metrics.actualBoundingBoxLeft, 300 * fraction);
		assert.equal(result.metrics.actualBoundingBoxRight, 300 * (1 - fraction));
	}
});

// 【句読点は元のフォントの字形を右上へ寄せる】
// 縦組み用Unicode文字への置換は読み込みフォントにない字形を要求してしまう。
// 実際の小さな字面を計測して、縦書きの枠内の右上へ配置する。
test('moves the original punctuation ink to the upper right of its cell', () => {
	const result = layoutVerticalTextLine('。', 100, 'left', () => ({
		...measure('。'), actualBoundingBoxRight: 20, actualBoundingBoxAscent: 0,
	}));
	assert.equal(result.runs[0].text, '。');
	assert.equal(-result.metrics.actualBoundingBoxLeft, 10);
	assert.equal(result.metrics.actualBoundingBoxAscent, 40);
	assert.equal(result.metrics.actualBoundingBoxDescent, -20);
});

// 【出力倍率の変更でも文字位置・輪郭の向きを一致させる】
// Timelineは字形の範囲だけを切り出し、GPU上限によって描画密度を変える。
// 保存した配置の座標も有効フォントサイズに追従し、本体と輪郭で同じ変換を使う。
test('scales cached placements and counterrotates only upright glyphs for both masks', () => {
	const line = layoutVerticalTextLine('日AB', 100, 'left', measure);
	for (const stroke of [false, true]) {
		const operations = [];
		const context = Object.fromEntries(['save', 'restore', 'translate', 'rotate', 'fillText', 'strokeText'].map(name => [name, (...args) => operations.push([name, ...args])]));
		drawVerticalTextLine(context, line, 50, 12, stroke);
		assert.deepEqual(operations.filter(([name]) => name === 'translate'), [['translate', 40, 37], ['translate', 50, 27]]);
		assert.deepEqual(operations.filter(([name]) => name === 'rotate'), [['rotate', -Math.PI / 2]]);
		assert.deepEqual(operations.filter(([name]) => name === (stroke ? 'strokeText' : 'fillText')).map(operation => operation[1]), ['日', 'AB']);
	}
});
