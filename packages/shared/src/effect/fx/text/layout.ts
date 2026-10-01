type TextLayoutOptions = {
	text: string;
	fontSize: number;
	lineHeight: number;
	alignment: 'left' | 'center' | 'right';
	overflow: 'none' | 'shrink' | 'compress';
	maxWidth: number;
};

type TextLineMetrics = Pick<TextMetrics, 'width' | 'actualBoundingBoxLeft' | 'actualBoundingBoxRight' | 'fontBoundingBoxAscent' | 'fontBoundingBoxDescent'>;

type TextBlockMetrics = {
	width: number;
	ascent: number;
	descent: number;
};

type TextLayout = {
	lines: string[];
	fontSize: number;
	horizontalScale: number;
	lineAdvance: number;
	firstBaselineOffset: number;
};

// 計測だけを呼び出し側へ委ね、GPUやCanvasの状態に依存せずレイアウトを計算できるようにする。
// measureTextは指定したfontSizeとalignmentで計測する。Positionは最大幅に影響させない。
export function layoutText(options: TextLayoutOptions, measureText: (text: string, fontSize: number) => TextLineMetrics): TextLayout | null {
	const { overflow, maxWidth } = options;
	const lineHeight = Math.max(0, options.lineHeight);
	let fontSize = options.fontSize;
	// Canvasは無効なfont代入を無視するため、以前の文字サイズを再利用させない。
	if (!(fontSize > 0) || ![fontSize, lineHeight, lineHeight * fontSize].every(Number.isFinite)) return null;
	// noneでは最大幅を参照しない。幅が0以下や非有限値の場合、調整モードでは描画しない。
	if (overflow !== 'none' && (!(maxWidth > 0) || !Number.isFinite(maxWidth))) return null;

	const lines = options.text.replace(/\r\n?/g, '\n').split('\n');
	const alignmentFraction = options.alignment === 'left' ? 0 : options.alignment === 'right' ? 1 : 0.5;

	function measureBlock(size: number): TextBlockMetrics {
		let width = 0;
		let ascent = 0;
		let descent = 0;
		for (const line of lines) {
			// 空行にも従来の高さを与えるが、代用文字Mgの幅で縮小を発生させない。
			const metrics = measureText(line || 'Mg', size);
			ascent = Math.max(ascent, metrics.fontBoundingBoxAscent);
			descent = Math.max(descent, metrics.fontBoundingBoxDescent);
			if (line.length === 0) continue;
			// advance幅には前後の空白、actual幅には斜体などの張り出しが含まれる。
			// 両者の領域の和集合を使い、空白を失ったり字形の幅を過小評価したりしない。
			const advanceLeft = metrics.width * alignmentFraction;
			const advanceRight = metrics.width - advanceLeft;
			width = Math.max(width,
				Math.max(advanceLeft, metrics.actualBoundingBoxLeft)
				+ Math.max(advanceRight, metrics.actualBoundingBoxRight));
		}
		return { width, ascent, descent };
	}

	let metrics = measureBlock(fontSize);
	let horizontalScale = 1;
	if (overflow !== 'none' && metrics.width > maxWidth) {
		const scale = maxWidth / metrics.width;
		if (overflow === 'compress') {
			horizontalScale = scale;
		} else {
			fontSize *= scale;
			if (!(fontSize > 0)) return null;
			metrics = measureBlock(fontSize);
			// フォントの計測値はサイズに完全には比例しないため、縮小後にも確認する。
			// 比例計算でまだ収まらなければ二分探索し、収まった側のサイズを採用する。
			// 探索回数を制限し、アニメーション中に計測を無制限に繰り返さない。
			if (metrics.width > maxWidth) {
				let lowerSize = 0;
				let upperSize = fontSize;
				let fittingMetrics: TextBlockMetrics | null = null;
				for (let attempt = 0; attempt < 16; attempt++) {
					const candidateSize = (lowerSize + upperSize) / 2;
					if (!(candidateSize > 0)) break;
					const candidateMetrics = measureBlock(candidateSize);
					if (candidateMetrics.width <= maxWidth) {
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
	// Yは複数行全体の中央。縮小時は行送りも縮め、横圧縮時は高さを維持する。
	const firstBaselineOffset = -(metrics.ascent + metrics.descent + (lines.length - 1) * lineAdvance) / 2 + metrics.ascent;
	return { lines, fontSize, horizontalScale, lineAdvance, firstBaselineOffset };
}
