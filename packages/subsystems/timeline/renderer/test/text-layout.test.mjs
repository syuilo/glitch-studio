import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutText } from '../src/layers/text/text-layout.ts';

// 実際のフォント・Canvas・GPUは使わず、既知の寸法を持つ文字列で配置の契約を確認する。
function createMeasurer(alignment, measureWidth = (text, size) => text.length * size) {
	const alignmentFraction = alignment === 'left' ? 0 : alignment === 'right' ? 1 : 0.5;
	return (text, size) => {
		const width = measureWidth(text, size);
		return {
			width,
			actualBoundingBoxLeft: width * alignmentFraction,
			actualBoundingBoxRight: width * (1 - alignmentFraction),
			actualBoundingBoxAscent: size * 0.8,
			actualBoundingBoxDescent: size * 0.2,
			fontBoundingBoxAscent: size * 0.8,
			fontBoundingBoxDescent: size * 0.2,
		};
	};
}

function layout(overrides = {}, measureText) {
	const options = {
		text: 'abcd\nab', fontSize: 100, outlineWidth: 0, lineHeight: 1.2,
		alignment: 'center', overflow: 'none', maxWidth: 300,
		...overrides,
	};
	return layoutText(options, measureText ?? createMeasurer(options.alignment));
}

// 【何もしない場合は最大幅に影響されず、収まる場合は拡大しない】
// 初期値のnoneは従来の表示を維持する。調整モードでもSizeは上限であり、
// テキストが短くなったときに希望サイズを超えて拡大してはいけない。
test('ignores the limit in none mode and never enlarges fitting text', () => {
	const original = layout();
	assert.equal(original.fontSize, 100);
	assert.equal(original.horizontalScale, 1);
	assert.equal(original.lineAdvance, 120);
	assert.equal(original.firstBaselineOffset, -30);
	for (const maxWidth of [0, -1, NaN, Infinity]) assert.deepEqual(layout({ maxWidth }), original);
	for (const overflow of ['shrink', 'compress']) {
		assert.deepEqual(layout({ overflow, maxWidth: 800 }), original);
	}
});

// 【最も長い行に合わせて全行のフォントサイズと行送りを縮める】
// 行ごとに異なるサイズを使わず、短い行との幅の比率も保つ。
// 複数行の中心をPosition Yへ配置できるよう、ベースラインも再計算する。
test('shrinks the whole block and its line spacing using the widest line', () => {
	for (const alignment of ['left', 'center', 'right']) {
		const result = layout({ overflow: 'shrink', alignment });
		assert.deepEqual(result, {
			lines: ['abcd', 'ab'], fontSize: 75, outlineWidth: 0, horizontalScale: 1,
			lineAdvance: 90, firstBaselineOffset: -22.5,
		});
	}
});

// 【横圧縮では全行に共通の倍率を使い、高さと行送りを維持する】
// 最も長い行だけを圧縮すると行ごとに字形が異なってしまう。
// フォント縮小とは異なり、縦方向の配置は元のままにする。
test('compresses all lines uniformly without changing vertical layout', () => {
	for (const alignment of ['left', 'center', 'right']) {
		assert.deepEqual(layout({ overflow: 'compress', alignment }), {
			...layout({ alignment }), horizontalScale: 0.75,
		});
	}
});

// 【サイズを変更しても実際の字形の中央を基準に拡縮する】
// フォントの上下の余白は、表示する文字の上下端と一致するとは限らない。
// ベースラインの片側にだけ描かれる記号も含め、見た目の中心が移動しないことを確認する。
test('keeps the ink center fixed as the font size changes', () => {
	const measure = createMeasurer('center');
	for (const [ascentRatio, descentRatio] of [[0.75, 0], [0.625, -0.5], [-0.125, 0.25]]) {
		for (const fontSize of [64, 128, 256]) {
			for (const outlineWidth of [0, 0.1]) {
				const result = layout({ text: 'A', fontSize, outlineWidth }, (text, size) => ({
					...measure(text, size),
					actualBoundingBoxAscent: size * ascentRatio,
					actualBoundingBoxDescent: size * descentRatio,
				}));
				const top = result.firstBaselineOffset - fontSize * ascentRatio;
				const bottom = result.firstBaselineOffset + fontSize * descentRatio;
				assert.equal((top + bottom) / 2, 0);
			}
		}
	}
});

// 【複数行は行ごとの字形と行送りを含めた全体の中央に配置する】
// 各行で字形の高さが違う場合、フォントの最大ascent/descentを全行へ当てはめるとずれる。
// 行送りが小さいと途中の行が上下端になる場合もあり、先頭と末尾だけでは判定できない。
// 最大幅による縮小・横圧縮でも同じ中央を保つ必要がある。
test('centers the complete multiline ink bounds for every overflow mode', () => {
	const measure = createMeasurer('center');
	const heights = { A: [0.5, 0], g: [0.375, 0.5], É: [1.125, 0] };
	for (const overflow of ['none', 'shrink', 'compress']) {
		for (const [lineHeight, topRatio, bottomRatio] of [[0, -1.125, 0.5], [0.25, -0.625, 0.75], [1.25, -0.5, 2.5]]) {
			const result = layout({ text: 'A\ng\nÉ', fontSize: 128, lineHeight, overflow, maxWidth: 64 }, (text, size) => ({
				...measure(text, size),
				actualBoundingBoxAscent: size * heights[text][0],
				actualBoundingBoxDescent: size * heights[text][1],
			}));
			const top = result.firstBaselineOffset + result.fontSize * topRatio;
			const bottom = result.firstBaselineOffset + result.fontSize * bottomRatio;
			assert.equal((top + bottom) / 2, 0);
		}
	}
});

// 【空白行は字形の中央揃えに切り替えても縦の余白を維持する】
// 先頭・末尾の空行や空白だけの行を無視すると、ユーザーが改行で指定した余白が消える。
// 字形のない行はフォントの高さで扱い、見える文字の上下端だけは実測値を使う。
test('retains leading and trailing blank line spacing around visible text', () => {
	const measure = createMeasurer('center');
	for (const text of ['\nA', 'A\n', ' \nA', 'A\n ']) {
		const result = layout({ text, lineHeight: 1.25 }, (line, size) => ({
			...measure(line, size),
			actualBoundingBoxLeft: line.trim() ? size / 2 : 0,
			actualBoundingBoxRight: line.trim() ? size / 2 : 0,
			actualBoundingBoxAscent: line.trim() ? size * 0.6 : 0,
			actualBoundingBoxDescent: 0,
		}));
		// 先頭が空行なら上下端は-80と125、末尾が空行なら-60と145になる。
		assert.equal(result.firstBaselineOffset, text.startsWith('A') ? -42.5 : -22.5);
	}
});

// 【前後の空白と字形の張り出しをどちらも幅に含める】
// advance幅だけでは斜体などの張り出しを失い、actual幅だけでは空白を失う。
// 左へ20張り出し、advanceが400、描画の右端が300なら必要幅は420になる。
test('includes both whitespace and ink overhang for every alignment', () => {
	for (const [alignment, anchor] of [['left', 0], ['center', 200], ['right', 400]]) {
		const result = layout({ text: 'text ', alignment, overflow: 'compress', maxWidth: 210 }, () => ({
			width: 400, actualBoundingBoxLeft: 20 + anchor, actualBoundingBoxRight: 300 - anchor,
			actualBoundingBoxAscent: 80, actualBoundingBoxDescent: 20,
			fontBoundingBoxAscent: 80, fontBoundingBoxDescent: 20,
		}));
		assert.equal(result.horizontalScale, 0.5);
	}
});

// 【空行の高さは維持し、代用文字の幅では縮小しない】
// 改行の正規化や末尾の空行を維持しながら、空行の計測に使うMgが
// 幅制限に引っかかってテキスト全体を縮めることを防ぐ。
test('preserves empty lines without fitting the placeholder glyphs', () => {
	for (const overflow of ['shrink', 'compress']) {
		const result = layout({ text: '\r\n\r', overflow, maxWidth: 1 });
		assert.deepEqual(result.lines, ['', '', '']);
		assert.equal(result.fontSize, 100);
		assert.equal(result.horizontalScale, 1);
		assert.equal(result.lineAdvance, 120);
		assert.equal(result.firstBaselineOffset, -90);
	}
});

// 【比例計算だけで収まらないフォントでも実測で収まるサイズを採用する】
// 計測値がサイズに完全比例することを前提にすると、縮小後にもはみ出し得る。
// 幅が100×sqrt(size)となる計測を使い、上限500に収まるsize=25へ近づくことを確認する。
test('remeasures and bounds the font search when widths are not proportional', () => {
	const measure = createMeasurer('center', (_text, size) => 100 * Math.sqrt(size));
	const result = layout({ overflow: 'shrink', maxWidth: 500 }, measure);
	assert.ok(result.fontSize <= 25 && result.fontSize > 24.999);
	assert.ok(measure('abcd', result.fontSize).width <= 500);
	assert.equal(result.horizontalScale, 1);
	assert.equal(result.lineAdvance, result.fontSize * 1.2);
});

// 【無効な寸法で以前のフォントを使ったり、非有限値をCanvasへ渡したりしない】
// 式から0・負数・非有限値が来ても、幅調整では描画なしにする。
// 計測に入る前に弾くことでCanvasの無効なfont代入の無視に影響されない。
test('rejects invalid dimensions before measuring', () => {
	const unexpectedMeasurement = () => assert.fail('Invalid dimensions must not be measured');
	for (const value of [0, -1, NaN, Infinity]) {
		assert.equal(layout({ fontSize: value }, unexpectedMeasurement), null);
		for (const overflow of ['shrink', 'compress']) {
			assert.equal(layout({ overflow, maxWidth: value }, unexpectedMeasurement), null);
		}
	}
});

// 【プレビュー・書き出しで倍率を変えても相対的な大きさを保つ】
// フォントサイズと最大幅に同じ描画倍率を掛ければ、横圧縮率は変わらず、
// 縮小後のフォントサイズや行送りだけが同じ倍率で変わる必要がある。
test('preserves relative layout when rendering resolution changes', () => {
	for (const overflow of ['shrink', 'compress']) {
		for (const outlineWidth of [0, 0.1]) {
			const original = layout({ overflow, outlineWidth });
			const doubled = layout({ overflow, outlineWidth, fontSize: 200, maxWidth: 600 });
			assert.equal(doubled.fontSize, original.fontSize * 2);
			assert.equal(doubled.outlineWidth, original.outlineWidth * 2);
			assert.equal(doubled.horizontalScale, original.horizontalScale);
			assert.equal(doubled.lineAdvance, original.lineAdvance * 2);
			assert.equal(doubled.firstBaselineOffset, original.firstBaselineOffset * 2);
		}
	}
});

// 【最大幅には外側の輪郭を含め、フォント縮小と同じ比率で太さを縮める】
// 文字だけを収めると輪郭が最大幅からはみ出す。元の幅400と左右の輪郭10ずつを
// 幅210へ収める場合、全行のフォントと輪郭の太さをともに半分にする必要がある。
test('fits and shrinks the outer outline together with every line', () => {
	for (const alignment of ['left', 'center', 'right']) {
		const result = layout({ alignment, overflow: 'shrink', maxWidth: 210, outlineWidth: 0.1 });
		assert.equal(result.fontSize, 50);
		assert.equal(result.outlineWidth, 5);
		assert.equal(result.horizontalScale, 1);
		assert.equal(result.lineAdvance, 60);
		assert.equal(result.firstBaselineOffset, -15);
	}
});

// 【横圧縮では輪郭を含めた幅から倍率を求め、縦方向の太さは維持する】
// Canvasでは文字とstrokeを同じ変換で描くため、輪郭の横幅だけが共通倍率で縮む。
// fontSizeや外側幅そのものを縮めてしまうと、縦方向まで細くなる。
test('includes the outline in horizontal compression without shrinking its height', () => {
	for (const alignment of ['left', 'center', 'right']) {
		const result = layout({ alignment, overflow: 'compress', maxWidth: 210, outlineWidth: 0.1 });
		assert.equal(result.fontSize, 100);
		assert.equal(result.outlineWidth, 10);
		assert.equal(result.horizontalScale, 0.5);
		assert.equal(result.lineAdvance, 120);
		assert.equal(result.firstBaselineOffset, -30);
	}
});

// 【前後の空白と空行自体にはアウトラインの余白を追加しない】
// 輪郭が広がるのは字形だけであり、advance幅の両端へ一律に余白を足すと過剰に縮小する。
// 空行の高さ計測用のMgも、輪郭を含む横幅の計算には使わない。
test('expands ink bounds without adding outline margins to whitespace', () => {
	const measure = () => ({
		width: 400, actualBoundingBoxLeft: -50, actualBoundingBoxRight: 350,
		actualBoundingBoxAscent: 80, actualBoundingBoxDescent: 20,
		fontBoundingBoxAscent: 80, fontBoundingBoxDescent: 20,
	});
	const result = layout({ text: ' text ', alignment: 'left', overflow: 'compress', maxWidth: 400, outlineWidth: 0.1 }, measure);
	assert.equal(result.horizontalScale, 1);
	const whitespace = layout({ text: '    ', overflow: 'compress', maxWidth: 400, outlineWidth: 0.1 }, () => ({
		...measure(), actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0,
	}));
	assert.equal(whitespace.horizontalScale, 1);
	assert.equal(layout({ text: '\n', overflow: 'shrink', maxWidth: 1, outlineWidth: 0.1 }).fontSize, 100);
});

// 【追加のサイズ探索でも候補サイズに応じた輪郭の太さで判定する】
// 最初に計算した輪郭幅を使い続けると、フォント縮小後に必要以上に小さくなってしまう。
// size=25で文字幅500と左右2.5ずつの輪郭を合わせて505になる計測を使う。
test('recalculates outline thickness while searching for a fitting font size', () => {
	const measure = createMeasurer('center', (_text, size) => 100 * Math.sqrt(size));
	const result = layout({ overflow: 'shrink', maxWidth: 505, outlineWidth: 0.1 }, measure);
	assert.ok(result.fontSize <= 25 && result.fontSize > 24.999);
	assert.equal(result.outlineWidth, result.fontSize * 0.1);
	assert.ok(measure('abcd', result.fontSize).width + result.outlineWidth * 2 <= 505);
});

// 【輪郭幅0以下は無効とし、非有限のstroke幅をCanvasへ渡さない】
// Canvasは無効なlineWidth代入を無視するため、前回の太さで輪郭が残ることを防ぐ。
// 式で比率が有限でも、pxやstrokeの全幅への変換で溢れる場合も描画前に弾く。
test('disables nonpositive outlines and rejects nonfinite stroke widths', () => {
	assert.deepEqual(layout({ outlineWidth: -0.1 }), layout());
	for (const outlineWidth of [NaN, Infinity, Number.MAX_VALUE]) {
		assert.equal(layout({ outlineWidth }, () => assert.fail('Invalid widths must not be measured')), null);
	}
});
