import { layoutVerticalTextLine } from '@gs/shared/text/vertical-text.ts';
import type { TextLineMetrics, VerticalTextLine } from '@gs/shared/text/vertical-text.ts';

type TextLayoutOptions = {
	writingMode: 'horizontal-tb' | 'vertical-rl';
	text: string;
	fontSize: number;
	outlineWidth: number;
	lineHeight: number;
	alignment: 'left' | 'center' | 'right';
	overflow: 'none' | 'shrink' | 'compress';
	maxInlineSize: number;
};

type TextBlockMetrics = {
	verticalLines?: VerticalTextLine[];
	width: number;
	top: number;
	bottom: number;
};

export type TextLayout = {
	verticalLines?: VerticalTextLine[];
	lines: string[];
	fontSize: number;
	// 文字の外側へ広がる幅。入力のsize比率を、採用したfontSizeでpxへ変換した値。
	outlineWidth: number;
	// 文字送り方向の倍率。縦書きではCanvasを回転してから適用する。
	inlineScale: number;
	lineAdvance: number;
	firstBaselineOffset: number;
};

// 計測だけを呼び出し側へ委ね、GPUやCanvasの状態に依存せずレイアウトを計算できるようにする。
// measureTextは指定したfontSizeとalignmentで計測する。Positionは最大長に影響させない。
export function layoutText(options: TextLayoutOptions, measureText: (text: string, fontSize: number) => TextLineMetrics): TextLayout | null {
	const { overflow, maxInlineSize } = options;
	const lineHeight = Math.max(0, options.lineHeight);
	const outlineWidthRatio = Math.max(0, options.outlineWidth);
	let fontSize = options.fontSize;
	// Canvasは無効なfont代入を無視するため、以前の文字サイズを再利用させない。
	if (!(fontSize > 0) || ![fontSize, lineHeight, lineHeight * fontSize].every(Number.isFinite)) return null;
	// strokeTextには外側幅の2倍を渡す。非有限のlineWidthが無視されて前回値が残るのを防ぐ。
	if (![outlineWidthRatio, outlineWidthRatio * fontSize * 2].every(Number.isFinite)) return null;
	// noneでは文字送り方向の最大長を参照しない。0以下や非有限値の場合、調整モードでは描画しない。
	if (overflow !== 'none' && (!(maxInlineSize > 0) || !Number.isFinite(maxInlineSize))) return null;

	const lines = options.text.replace(/\r\n?/g, '\n').split('\n');
	const alignmentFraction = options.alignment === 'left' ? 0 : options.alignment === 'right' ? 1 : 0.5;

	function measureBlock(size: number): TextBlockMetrics {
		const verticalLines = options.writingMode === 'vertical-rl' ? [] as VerticalTextLine[] : null;
		let width = 0;
		let top = Infinity;
		let bottom = -Infinity;
		const outlineWidth = outlineWidthRatio * size;
		const lineAdvance = lineHeight * size;
		for (const [index, line] of lines.entries()) {
			// 空行にも従来の高さを与えるが、代用文字Mgの幅で縮小を発生させない。
			const verticalLine = verticalLines == null ? null : layoutVerticalTextLine(line, size, options.alignment, text => measureText(text, size));
			if (verticalLine != null) verticalLines!.push(verticalLine);
			const metrics = verticalLine?.metrics ?? measureText(line || 'Mg', size);
			// フォント全体の余白を中央の基準にすると、サイズ変更時に見た目の中心が移動する。
			// 各行の実際の字形と行送りから上下端を求める。描画されない空行・空白行だけは
			// フォントの高さを使い、先頭・末尾の改行による余白を維持する。
			const hasInk = line.length > 0 && metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight > 0;
			const ascent = hasInk ? metrics.actualBoundingBoxAscent : metrics.fontBoundingBoxAscent;
			const descent = hasInk ? metrics.actualBoundingBoxDescent : metrics.fontBoundingBoxDescent;
			const baseline = index * lineAdvance;
			// 記号などではascentやdescentが負になるため、0へ丸めず上下端をそのまま使う。
			top = Math.min(top, baseline - ascent);
			bottom = Math.max(bottom, baseline + descent);
			if (line.length === 0) continue;
			// advance幅には前後の空白、actual幅には斜体などの張り出しが含まれる。
			// 両者の領域の和集合を使い、空白を失ったり字形の幅を過小評価したりしない。
			const advanceLeft = metrics.width * alignmentFraction;
			const advanceRight = metrics.width - advanceLeft;
			// round joinで描く輪郭の張り出しは外側幅以内に収まる。
			// 空白だけの行には字形がないため、そのadvance領域を輪郭で膨らませない。
			const outlinePadding = hasInk ? outlineWidth : 0;
			width = Math.max(width,
				Math.max(advanceLeft, metrics.actualBoundingBoxLeft + outlinePadding)
				+ Math.max(advanceRight, metrics.actualBoundingBoxRight + outlinePadding));
		}
		return { width, top, bottom, ...(verticalLines == null ? {} : { verticalLines }) };
	}

	let metrics = measureBlock(fontSize);
	let inlineScale = 1;
	if (overflow !== 'none' && metrics.width > maxInlineSize) {
		const scale = maxInlineSize / metrics.width;
		if (overflow === 'compress') {
			inlineScale = scale;
		} else {
			fontSize *= scale;
			if (!(fontSize > 0)) return null;
			metrics = measureBlock(fontSize);
			// フォントの計測値はサイズに完全には比例しないため、縮小後にも確認する。
			// 比例計算でまだ収まらなければ二分探索し、収まった側のサイズを採用する。
			// 探索回数を制限し、アニメーション中に計測を無制限に繰り返さない。
			if (metrics.width > maxInlineSize) {
				let lowerSize = 0;
				let upperSize = fontSize;
				let fittingMetrics: TextBlockMetrics | null = null;
				for (let attempt = 0; attempt < 16; attempt++) {
					const candidateSize = (lowerSize + upperSize) / 2;
					if (!(candidateSize > 0)) break;
					const candidateMetrics = measureBlock(candidateSize);
					if (candidateMetrics.width <= maxInlineSize) {
						lowerSize = candidateSize;
						fittingMetrics = candidateMetrics;
					} else {
						upperSize = candidateSize;
					}
				}
				if (fittingMetrics == null) return null;
				fontSize = lowerSize;
				metrics = fittingMetrics;
			}
		}
	}

	const lineAdvance = lineHeight * fontSize;
	// 論理Yは複数行全体の中央。縦書きでは描画時の90度回転により列の左右の中央になる。
	// 縮小時は行送りも縮め、文字送り方向だけを圧縮するときは列間隔を維持する。
	const firstBaselineOffset = -(metrics.top + metrics.bottom) / 2;
	return {
		...(metrics.verticalLines == null ? {} : { verticalLines: metrics.verticalLines }),
		lines,
		fontSize,
		outlineWidth: outlineWidthRatio * fontSize,
		inlineScale,
		lineAdvance,
		firstBaselineOffset,
	};
}
