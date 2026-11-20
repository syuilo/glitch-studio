import assert from 'node:assert/strict';
import { test } from 'node:test';
import { measureTextPattern, layoutTextPattern } from '../src/fx/textPattern/layout.ts';
import { packTextPatternAtlas } from '../src/fx/textPattern/atlas.ts';

function measure(text) {
	const width = text === ' ' ? 5 : text === 'i' ? 4 : 10;
	return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text === ' ' ? 0 : width,
		actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 2, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 };
}

function completeLayout(text, options = {}) {
	return layoutTextPattern(measureTextPattern(text, measure), {
		fontSize: 10, lineHeight: 1.2, repetitions: [1, 1], position: [0, 0], alignment: 'center',
		resolution: { width: 100, height: 100 }, maxInstances: 1000, ...options,
	});
}

function layout(text, options = {}) {
	return completeLayout(text, options).characters.filter(placement => placement.glyph.width > 0);
}

// 【結合文字や絵文字を分離せず、同じ字形を反復回数によらず共有する】
// コードポイントごとの分割では濁点・アクセント・ZWJ絵文字が別々に動いてしまう。
// CRLFの正規化と前後の空白も、ユーザーが入力した基本配置を維持するために必要。
test('measures graphemes once and preserves whitespace and line breaks', () => {
	const measured = [];
	const result = measureTextPattern(' A\u0301👩‍💻A\u0301 \r\n i ', text => { measured.push(text); return measure(text); });
	assert.deepEqual(result.lines.map(line => line.map(glyph => glyph.text)), [[' ', 'A\u0301', '👩‍💻', 'A\u0301', ' '], [' ', 'i', ' ']]);
	assert.equal(measured.filter(text => text === 'A\u0301').length, 1);
	assert.equal(result.glyphs.length, 3);
	assert.equal(result.lines[0][1], result.lines[0][3]);
});

// 【フォントの送り幅を使い、横反復間の空白と行全体の整列を反映する】
// 等幅のグリッドへ置き換えると、プロポーショナルフォントや意図した空白が失われる。
// 左・中央・右の整列は、反復後の行全体に対して一度だけ適用する。
test('uses proportional advances and separates horizontal repetitions with a space', () => {
	for (const [alignment, origin] of [['left', 50], ['center', 33.5], ['right', 17]]) {
		const result = layout('Ai', { alignment, repetitions: [2, 1] });
		assert.deepEqual(result.map(placement => placement.centerX), [origin + 5, origin + 12, origin + 24, origin + 31]);
		assert.ok(result.every(placement => placement.centerY === 50));
	}
	assert.equal(layout(' A ')[0].centerX, 50);
});

// 【字形の幅を保ち、残りの画面幅を文字間へ均等に配分する】
// 単なる横拡大では文字自体が歪み、フォントサイズの指定が意味を失ってしまう。
// 幅の異なる文字でも送り枠の間隔を揃え、両端の配置枠が画面端に一致することを確認する。
test('distributes proportional characters across the full width without scaling glyphs', () => {
	const result = layout('AiiA', { alignment: 'distribute' });
	assert.deepEqual(result.map(placement => placement.centerX), [5, 36, 64, 95]);
	assert.equal(result[0].centerX - result[0].glyph.advance / 2, 0);
	assert.equal(result.at(-1).centerX + result.at(-1).glyph.advance / 2, 100);
	for (let index = 1; index < result.length; index++) {
		const previous = result[index - 1];
		const current = result[index];
		assert.equal(current.centerX - current.glyph.advance / 2 - previous.centerX - previous.glyph.advance / 2, 24);
	}
	assert.deepEqual(result.map(placement => placement.glyph.advance), [10, 4, 4, 10]);
});

// 【横反復・空白を含む各行を、独立して均等割付する】
// 反復単位ごとに画面幅へ広げたり、短い行を通常幅のまま残したりしない。
// 行頭・行末の空白も配置枠として残し、位置指定は割付後の全体へ適用する。
test('distributes complete repeated rows including spaces and preserves block positioning', () => {
	const result = completeLayout('Ai\nA', { alignment: 'distribute', repetitions: [2, 1], position: [0.5, 0] });
	assert.deepEqual(result.characters.map(placement => placement.centerX), [30, 53.75, 75, 99.25, 123, 30, 75, 120]);
	assert.deepEqual(result.rows, [{ firstCharacter: 0, characterCount: 5 }, { firstCharacter: 5, characterCount: 3 }]);
	const padded = completeLayout(' A ', { alignment: 'distribute' });
	assert.deepEqual(padded.characters.map(placement => placement.centerX), [2.5, 50, 97.5]);
});

// 【1文字の行は中央へ置き、狭い出力では字形を縮めず間隔を詰める】
// 文字数から1を引いた除算でNaNを作らず、文字サイズを固定したまま基準配置を決める。
test('centers single characters and allows negative spacing in narrow outputs', () => {
	assert.equal(layout('A', { alignment: 'distribute' })[0].centerX, 50);
	assert.equal(layout('A', { alignment: 'distribute', position: [-0.5, 0] })[0].centerX, 25);
	const narrow = layout('AiA', { alignment: 'distribute', resolution: { width: 10, height: 100 } });
	assert.deepEqual(narrow.map(placement => placement.centerX), [5, 5, 5]);
	assert.deepEqual(narrow.map(placement => placement.glyph.advance), [10, 4, 10]);
});

// 【複数行の文字列を行ブロックとして繰り返し、空行の高さも残す】
// 反復ごとに中央へ戻したり空行を捨てたりすると、画面全体へ連続したパターンを作れない。
// 基準点は字形の見かけの中心ではなく、フォントの配置枠の中心に統一する。
test('repeats multiline blocks vertically and centers their complete layout', () => {
	const result = layout('A\n\ni', { repetitions: [1, 2] });
	assert.deepEqual(result.map(placement => [placement.glyph.text, placement.centerY]), [['A', 20], ['i', 44], ['A', 56], ['i', 80]]);
	const moved = layout('A', { position: [0.5, 0.5] });
	assert.deepEqual([moved[0].centerX, moved[0].centerY], [75, 25]);
});

// 【出力解像度だけを変えても、正規化した位置と文字サイズを維持する】
// 低解像度のプレビューと動画書き出しで配置が変わらないことを保証する。
// 出力の横幅だけが変わる場合も、文字送りは高さ基準なので字形が横に伸びない。
test('keeps layout independent of resolution and aspect ratio', () => {
	const original = layout('Ai', { repetitions: [2, 2] });
	const measured = measureTextPattern('Ai', text => Object.fromEntries(Object.entries(measure(text)).map(([key, value]) => [key, value * 2])));
	const enlarged = layoutTextPattern(measured, { fontSize: 20, lineHeight: 1.2, repetitions: [2, 2], position: [0, 0], alignment: 'center', resolution: { width: 200, height: 200 }, maxInstances: 1000 });
	assert.deepEqual(enlarged.characters.filter(placement => placement.glyph.width > 0).map(placement => [placement.centerX / 2, placement.centerY / 2]), original.map(placement => [placement.centerX, placement.centerY]));
	const wide = layout('Ai', { repetitions: [2, 2], resolution: { width: 200, height: 100 } });
	assert.deepEqual(wide.map(placement => [placement.centerX - 50, placement.centerY]), original.map(placement => [placement.centerX, placement.centerY]));
});

// 【大量の反復を確保前に拒否し、空文字列や無効な設定では描画を残さない】
// 式から極端な回数・非有限値が来ても、無制限の配列確保や長時間のループを行わない。
test('checks character limits before expanding repetitions and handles empty layouts', () => {
	assert.throws(() => layout('A', { repetitions: [1e9, 1e9] }), /GPU character limit/);
	assert.throws(() => layout('AA', { maxInstances: 1 }), /GPU character limit/);
	assert.deepEqual(layout(' \n '), []);
	for (const fontSize of [0, -1, NaN, Infinity]) assert.deepEqual(layout('A', { fontSize }), []);
	assert.deepEqual(layout('A', { repetitions: [NaN, 1] }), []);
	assert.deepEqual(layout('A', { position: [Infinity, 0] }), []);
});

// 【空白・反復区切りを字間の評価点に残し、改行ごとに独立した範囲へ分ける】
// 空白を省くと、その前後のTrackingや後続文字への累積量が変わってしまう。
// 空行は縦の位置を保ちながらGPU処理を省き、行間隔0でも隣の行へ累積しない。
test('keeps whitespace evaluation points and independent row ranges for tracking', () => {
	const result = completeLayout(' A \n\nB', { repetitions: [2, 2], lineHeight: 0 });
	assert.deepEqual(result.rows, [
		{ firstCharacter: 0, characterCount: 7 }, { firstCharacter: 7, characterCount: 3 },
		{ firstCharacter: 10, characterCount: 7 }, { firstCharacter: 17, characterCount: 3 },
	]);
	assert.deepEqual(result.rows.map(row => result.characters.slice(row.firstCharacter, row.firstCharacter + row.characterCount).map(placement => placement.glyph.text).join('')), [' A   A ', 'B B', ' A   A ', 'B B']);
	assert.ok(result.characters.every(placement => placement.centerY === 50));
	assert.deepEqual(completeLayout(' \n '), { characters: [], rows: [] });
});

// 【字形のない評価点もGPUバッファの上限へ含める】
// 見える文字だけを数えると、大量の空白や反復区切りでGPUの確保上限を超え得る。
test('includes spaces and repetition separators in the character limit', () => {
	assert.throws(() => completeLayout('A ', { repetitions: [2, 1], maxInstances: 4 }), /GPU character limit/);
	assert.equal(completeLayout('A ', { repetitions: [2, 1], maxInstances: 5 }).characters.length, 5);
});

// 【字形の領域を重ねずにアトラスへ詰め、GPU上限を超えた場合は明示的に失敗する】
// 隣の字形が混ざることや、Canvas・GPUの作成時に不明瞭なエラーになることを防ぐ。
test('packs non-overlapping glyphs within the texture limit', () => {
	const glyphs = measureTextPattern('AiABCDEF', measure).glyphs;
	const atlas = packTextPatternAtlas(glyphs, 64);
	assert.ok(atlas.width <= 64 && atlas.height <= 64);
	for (const [glyph, origin] of atlas.entries) {
		assert.ok(origin.x + glyph.width <= atlas.width && origin.y + glyph.height <= atlas.height);
		for (const [other, otherOrigin] of atlas.entries) {
			if (glyph === other) continue;
			assert.ok(origin.x + glyph.width <= otherOrigin.x || otherOrigin.x + other.width <= origin.x || origin.y + glyph.height <= otherOrigin.y || otherOrigin.y + other.height <= origin.y);
		}
	}
	assert.throws(() => packTextPatternAtlas(glyphs, 10), /GPU texture limit/);
	assert.equal(packTextPatternAtlas([], 64).entries.size, 0);
});
