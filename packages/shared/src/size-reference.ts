export const SIZE_REFERENCES = ['height', 'width', 'shortSide', 'longSide'] as const;
export type SizeReference = typeof SIZE_REFERENCES[number];

export function isSizeReference(value: unknown): value is SizeReference {
	return typeof value === 'string' && SIZE_REFERENCES.some(reference => reference === value);
}

/** 同じ基準寸法を縦横の距離へ使う。位置座標・対象自身に対する比率・入出力データの単位は変更しない。 */
export function getSizeReferenceLength(reference: SizeReference, resolution: { width: number; height: number }): number {
	switch (reference) {
		case 'height': return resolution.height;
		case 'width': return resolution.width;
		case 'shortSide': return Math.min(resolution.width, resolution.height);
		case 'longSide': return Math.max(resolution.width, resolution.height);
	}
	throw new Error(`Invalid Size Reference: ${JSON.stringify(reference)}`);
}
