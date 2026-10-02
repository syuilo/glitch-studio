// エフェクトの描画サイズ指定。contextの具体的な意味は呼び出し側が決める。
export type EffectResolution =
	| { mode: 'context' }
	| { mode: 'auto' }
	| { mode: 'customAbsolute'; width: number; height: number };

export function validateEffectResolution(resolution: EffectResolution): void {
	if (!['auto', 'context', 'customAbsolute'].includes(resolution.mode)) throw new Error('Invalid effect resolution mode');
	if (resolution.mode === 'customAbsolute' && ![resolution.width, resolution.height].every(value => Number.isSafeInteger(value) && value > 0)) {
		throw new Error('Effect resolution must use positive integer dimensions');
	}
}
