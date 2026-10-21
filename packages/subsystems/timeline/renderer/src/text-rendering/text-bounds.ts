import type { TextLayout } from './text-layout.ts';

/** レイアウトの基準点から見た字形と輪郭の範囲。空白のadvance幅と画素の存在は区別する。 */
export function measureTextInkBounds(layout: TextLayout, measure: (line: string) => Pick<TextMetrics, 'actualBoundingBoxLeft' | 'actualBoundingBoxRight' | 'actualBoundingBoxAscent' | 'actualBoundingBoxDescent'>) {
	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;
	for (const [index, line] of layout.lines.entries()) {
		const metrics = measure(line);
		if (!(metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight > 0)) continue;
		const baseline = layout.firstBaselineOffset + index * layout.lineAdvance;
		left = Math.min(left, (-metrics.actualBoundingBoxLeft - layout.outlineWidth) * layout.horizontalScale);
		right = Math.max(right, (metrics.actualBoundingBoxRight + layout.outlineWidth) * layout.horizontalScale);
		top = Math.min(top, baseline - metrics.actualBoundingBoxAscent - layout.outlineWidth);
		bottom = Math.max(bottom, baseline + metrics.actualBoundingBoxDescent + layout.outlineWidth);
	}
	return Number.isFinite(left) ? {
		left,
		top,
		right,
		bottom,
	} : null;
}
