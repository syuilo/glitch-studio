export type Resolution = { width: number; height: number };

/** 各軸へ倍率を掛け、四捨五入して最低1pxを保つ。 */
export function scaleResolution(resolution: Resolution, scale: number): Resolution {
	if (!Number.isFinite(scale) || scale <= 0) throw new Error('Resolution scale must be positive and finite');
	if (![resolution.width, resolution.height].every(value => Number.isSafeInteger(value) && value > 0)) {
		throw new Error('Resolution width and height must be positive integers');
	}
	return {
		width: Math.max(1, Math.round(resolution.width * scale)),
		height: Math.max(1, Math.round(resolution.height * scale)),
	};
}
