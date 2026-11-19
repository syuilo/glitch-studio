type TextPatternMeasurement = Pick<TextMetrics, 'width' | 'actualBoundingBoxLeft' | 'actualBoundingBoxRight' | 'actualBoundingBoxAscent' | 'actualBoundingBoxDescent' | 'fontBoundingBoxAscent' | 'fontBoundingBoxDescent'>;

export type TextPatternGlyph = {
	text: string;
	advance: number;
	left: number;
	top: number;
	width: number;
	height: number;
};

export type TextPatternMeasurements = {
	lines: TextPatternGlyph[][];
	separator: TextPatternGlyph;
	glyphs: TextPatternGlyph[];
	ascent: number;
	descent: number;
};

type TextPatternLayout = {
	characters: { glyph: TextPatternGlyph; centerX: number; centerY: number }[];
	rows: { firstCharacter: number; characterCount: number }[];
};

// UTF-16のコード単位やコードポイントではなく、結合文字・ZWJ絵文字をまとめて扱う。
// 文脈依存の字形置換は行わず、各書記素のフォント本来の送り幅で独立配置する。
export function measureTextPattern(text: string, measureText: (text: string) => TextPatternMeasurement): TextPatternMeasurements {
	const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
	const measured = new Map<string, TextPatternGlyph>();
	const fontMetrics = measureText('Mg');
	if (![fontMetrics.fontBoundingBoxAscent, fontMetrics.fontBoundingBoxDescent].every(Number.isFinite)) throw new Error('Text Pattern font returned invalid line metrics.');
	let ascent = fontMetrics.fontBoundingBoxAscent;
	let descent = fontMetrics.fontBoundingBoxDescent;

	function measureGlyph(grapheme: string) {
		let glyph = measured.get(grapheme);
		if (glyph != null) return glyph;
		const metrics = measureText(grapheme);
		if (![metrics.width, metrics.actualBoundingBoxLeft, metrics.actualBoundingBoxRight, metrics.actualBoundingBoxAscent, metrics.actualBoundingBoxDescent, metrics.fontBoundingBoxAscent, metrics.fontBoundingBoxDescent].every(Number.isFinite)) {
			throw new Error('Text Pattern font returned invalid character metrics.');
		}
		ascent = Math.max(ascent, metrics.fontBoundingBoxAscent);
		descent = Math.max(descent, metrics.fontBoundingBoxDescent);
		// linear補間で隣の字形が混ざらず、字形端の被覆率も欠けないよう透明な余白を含める。
		const left = Math.floor(-metrics.actualBoundingBoxLeft) - 2;
		const top = Math.floor(-metrics.actualBoundingBoxAscent) - 2;
		const hasInk = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight > 0 && metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent > 0;
		glyph = {
			text: grapheme, advance: metrics.width, left, top,
			width: hasInk ? Math.ceil(metrics.actualBoundingBoxRight) + 2 - left : 0,
			height: hasInk ? Math.ceil(metrics.actualBoundingBoxDescent) + 2 - top : 0,
		};
		measured.set(grapheme, glyph);
		return glyph;
	}

	const lines = text.replace(/\r\n?/g, '\n').split('\n').map(line => Array.from(segmenter.segment(line), segment => measureGlyph(segment.segment)));
	const separator = measureGlyph(' ');
	return { lines, separator, glyphs: [...measured.values()].filter(glyph => glyph.width > 0), ascent, descent };
}

export function layoutTextPattern(measurements: TextPatternMeasurements, options: {
	fontSize: number;
	lineHeight: number;
	repetitions: readonly [number, number];
	position: readonly [number, number];
	alignment: 'left' | 'center' | 'right' | 'distribute';
	resolution: { width: number; height: number };
	maxInstances: number;
}): TextPatternLayout {
	const { fontSize, lineHeight, repetitions, position, resolution, maxInstances } = options;
	const layout: TextPatternLayout = { characters: [], rows: [] };
	if (![fontSize, lineHeight, ...repetitions, ...position].every(Number.isFinite) || fontSize <= 0) return layout;
	const horizontalRepetitions = Math.max(1, Math.round(repetitions[0]));
	const verticalRepetitions = Math.max(1, Math.round(repetitions[1]));
	// 空白もTrackingの評価点になる。字形のない行は描画せず、縦の配置にだけ高さを残す。
	// 反復で増やす前に、区切りの空白を含めた全評価点をGPUの上限と照合する。
	const charactersPerBlock = measurements.lines.reduce((sum, line) => line.some(glyph => glyph.width > 0)
		? sum + line.length * horizontalRepetitions + horizontalRepetitions - 1 : sum, 0);
	if (charactersPerBlock === 0) return layout;
	const instanceCount = charactersPerBlock * verticalRepetitions;
	if (!Number.isSafeInteger(instanceCount) || instanceCount > maxInstances) throw new Error('Text Pattern exceeds the GPU character limit.');
	const lineAdvance = Math.max(0, lineHeight) * fontSize;
	const lineCount = measurements.lines.length * verticalRepetitions;
	const blockHeight = measurements.ascent + measurements.descent + (lineCount - 1) * lineAdvance;
	const firstBaseline = (1 - position[1]) * resolution.height / 2 - blockHeight / 2 + measurements.ascent;
	const cellCenterOffset = (measurements.descent - measurements.ascent) / 2;
	const alignmentFraction = options.alignment === 'left' ? 0 : options.alignment === 'right' ? 1 : 0.5;
	for (let repetition = 0; repetition < verticalRepetitions; repetition++) {
		for (const [lineIndex, line] of measurements.lines.entries()) {
			if (!line.some(glyph => glyph.width > 0)) continue;
			const lineWidth = line.reduce((sum, glyph) => sum + glyph.advance, 0) * horizontalRepetitions + measurements.separator.advance * (horizontalRepetitions - 1);
			const characterCount = line.length * horizontalRepetitions + horizontalRepetitions - 1;
			const distribute = options.alignment === 'distribute' && characterCount > 1;
			// 書記素の送り幅は変えず、残りの幅を全ての文字間へ同量ずつ配分する。
			// 1文字では配分先がないため中央へ置く。行が画面幅より長い場合は負の字間で詰める。
			// 位置・Trackingの入力は、この均等割付まで反映した基準点を使って評価する。
			const distributedSpacing = distribute ? (resolution.width - lineWidth) / (characterCount - 1) : 0;
			const effectiveWidth = distribute ? resolution.width : lineWidth;
			let cursor = (position[0] + 1) * resolution.width / 2 - effectiveWidth * alignmentFraction;
			const centerY = firstBaseline + (repetition * measurements.lines.length + lineIndex) * lineAdvance + cellCenterOffset;
			const firstCharacter = layout.characters.length;
			for (let column = 0; column < horizontalRepetitions; column++) {
				if (column > 0) {
					layout.characters.push({ glyph: measurements.separator, centerX: cursor + measurements.separator.advance / 2, centerY });
					cursor += measurements.separator.advance + distributedSpacing;
				}
				for (const glyph of line) {
					layout.characters.push({ glyph, centerX: cursor + glyph.advance / 2, centerY });
					cursor += glyph.advance + distributedSpacing;
				}
			}
			layout.rows.push({ firstCharacter, characterCount: layout.characters.length - firstCharacter });
		}
	}
	return layout;
}
