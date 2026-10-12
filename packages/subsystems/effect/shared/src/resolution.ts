// エフェクトの描画サイズ指定。contextの具体的な意味は呼び出し側が決める。
export type EffectResolution =
	| { mode: 'context' }
	| { mode: 'auto' }
	| { mode: 'customAbsolute'; width: number; height: number };

export function validateEffectResolution(resolution: EffectResolution): void {
	const diagnostics = inspectEffectResolution(resolution);
	if (diagnostics.length) throw new Error(diagnostics[0].message);
}

export function inspectEffectResolution(resolution: EffectResolution): import('@gs/shared/validation/diagnostic.ts').ValidationDiagnostic[] {
	if (!['auto', 'context', 'customAbsolute'].includes(resolution.mode)) return [{ code: 'effect.resolution', message: 'Invalid effect resolution mode' }];
	return resolution.mode === 'customAbsolute' && ![resolution.width, resolution.height].every(value => Number.isSafeInteger(value) && value > 0)
		? [{ code: 'effect.resolution', message: 'Effect resolution must use positive integer dimensions' }] : [];
}
