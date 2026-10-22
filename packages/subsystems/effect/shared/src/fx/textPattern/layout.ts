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
	alignment: 'left' | 'center' | 'right';
	resolution: { width: number; height: number };
	maxInstances: number;
}) {
	const { fontSize, lineHeight, repetitions, position, resolution, maxInstances } = options;
	if (![fontSize, lineHeight, ...repetitions, ...position].every(Number.isFinite) || fontSize <= 0) return [];
	const horizontalRepetitions = Math.max(1, Math.round(repetitions[0]));
	const verticalRepetitions = Math.max(1, Math.round(repetitions[1]));
	const visibleCount = measurements.lines.reduce((sum, line) => sum + line.filter(glyph => glyph.width > 0).length, 0);
	if (visibleCount === 0) return [];
	const instanceCount = visibleCount * horizontalRepetitions * verticalRepetitions;
	if (!Number.isSafeInteger(instanceCount) || instanceCount > maxInstances) throw new Error('Text Pattern exceeds the GPU character limit.');
	const lineAdvance = Math.max(0, lineHeight) * fontSize;
	const lineCount = measurements.lines.length * verticalRepetitions;
	const blockHeight = measurements.ascent + measurements.descent + (lineCount - 1) * lineAdvance;
	const firstBaseline = (1 - position[1]) * resolution.height / 2 - blockHeight / 2 + measurements.ascent;
	const cellCenterOffset = (measurements.descent - measurements.ascent) / 2;
	const alignmentFraction = options.alignment === 'left' ? 0 : options.alignment === 'right' ? 1 : 0.5;
	const placements: { glyph: TextPatternGlyph; centerX: number; centerY: number }[] = [];
	for (let repetition = 0; repetition < verticalRepetitions; repetition++) {
		for (const [lineIndex, line] of measurements.lines.entries()) {
			const lineWidth = line.reduce((sum, glyph) => sum + glyph.advance, 0) * horizontalRepetitions + measurements.separator.advance * (horizontalRepetitions - 1);
			let cursor = (position[0] + 1) * resolution.width / 2 - lineWidth * alignmentFraction;
			const centerY = firstBaseline + (repetition * measurements.lines.length + lineIndex) * lineAdvance + cellCenterOffset;
			for (let column = 0; column < horizontalRepetitions; column++) {
				for (const glyph of line) {
					if (glyph.width > 0) placements.push({ glyph, centerX: cursor + glyph.advance / 2, centerY });
					cursor += glyph.advance;
				}
				cursor += measurements.separator.advance;
			}
		}
	}
	return placements;
}
