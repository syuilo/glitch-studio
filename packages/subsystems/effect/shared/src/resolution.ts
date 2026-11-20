// エフェクトの描画サイズ指定。contextの具体的な意味は呼び出し側が決める。
// scaleは幅・高さ共通の設定倍率で、呼び出し側のプレビュー・書き出し全体の倍率とは独立する。
export type EffectResolution =
	| { mode: 'context'; scale: number }
	| { mode: 'auto'; scale: number }
	| { mode: 'customAbsolute'; width: number; height: number };

export function validateEffectResolution(resolution: EffectResolution): void {
	if (!['auto', 'context', 'customAbsolute'].includes(resolution.mode)) throw new Error('Invalid effect resolution mode');
	if (resolution.mode !== 'customAbsolute' && (!Number.isFinite(resolution.scale) || resolution.scale <= 0)) {
		throw new Error('Effect resolution scale must be positive and finite');
	}
	if (resolution.mode === 'customAbsolute' && ![resolution.width, resolution.height].every(value => Number.isSafeInteger(value) && value > 0)) {
		throw new Error('Effect resolution must use positive integer dimensions');
	}
}
