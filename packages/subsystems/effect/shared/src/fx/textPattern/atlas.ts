import type { TextPatternGlyph } from './layout.ts';

export function packTextPatternAtlas(glyphs: readonly TextPatternGlyph[], maxDimension: number) {
	if (glyphs.length === 0) return { width: 1, height: 1, entries: new Map<TextPatternGlyph, { x: number; y: number }>() };
	const widest = glyphs.reduce((width, glyph) => Math.max(width, glyph.width), 0);
	const area = glyphs.reduce((sum, glyph) => sum + glyph.width * glyph.height, 0);
	if (widest > maxDimension || glyphs.some(glyph => glyph.height > maxDimension) || area > maxDimension ** 2) {
		throw new Error('Text Pattern glyph atlas exceeds the GPU texture limit.');
	}
	let shelfWidth = Math.min(maxDimension, Math.max(widest, Math.ceil(Math.sqrt(area))));
	while (true) {
		const entries = new Map<TextPatternGlyph, { x: number; y: number }>();
		let x = 0;
		let y = 0;
		let shelfHeight = 0;
		let width = 1;
		for (const glyph of glyphs) {
			if (x + glyph.width > shelfWidth) {
				y += shelfHeight;
				x = 0;
				shelfHeight = 0;
			}
			entries.set(glyph, { x, y });
			x += glyph.width;
			width = Math.max(width, x);
			shelfHeight = Math.max(shelfHeight, glyph.height);
		}
		const height = y + shelfHeight;
		if (height <= maxDimension) return { width, height, entries };
		if (shelfWidth === maxDimension) throw new Error('Text Pattern glyph atlas exceeds the GPU texture limit.');
		shelfWidth = Math.min(maxDimension, shelfWidth * 2);
	}
}
