export type Resolution = { width: number; height: number };

/** 素材・指定寸法には一度だけ適用する。上流の計算用テクスチャには再適用しない。 */
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

/** 明示設定は更新境界で検証済み。素材の原寸にはscaleResolutionを使う。 */
export function scaleConfiguredResolution(resolution: Resolution, scale: number): Resolution {
	return { width: Math.max(1, Math.round(resolution.width * scale)), height: Math.max(1, Math.round(resolution.height * scale)) };
}
