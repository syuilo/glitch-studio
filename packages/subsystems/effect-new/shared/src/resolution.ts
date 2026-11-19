import { scaleResolution, type Resolution } from '@gs/shared/resolution.ts';

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

/** GPUに触れずサイズを解決する。context/inputは計算用、intrinsic/customは倍率適用前の寸法。 */
export function resolveEffectNodeResolution(options: {
	setting: EffectResolution;
	contextResolution: Resolution;
	resolutionScale: number;
	intrinsicResolution?: Resolution | null;
	inputResolution?: Resolution | null;
	maxDimension: number;
}): Resolution {
	const { setting } = options;
	const baseResolution = setting.mode === 'customAbsolute' ? scaleResolution(setting, options.resolutionScale)
		: setting.mode === 'context' ? options.contextResolution
		: options.intrinsicResolution != null ? scaleResolution(options.intrinsicResolution, options.resolutionScale)
		: options.inputResolution ?? options.contextResolution;
	// context/inputには全体のプレビュー・書き出し倍率が適用済みなので、再適用しない。
	// 設定の倍率は各ノード・レイヤーに固有で、入力追従では上流の倍率を引き継いだ寸法へ掛ける。
	const resolution = setting.mode === 'customAbsolute' ? baseResolution : scaleResolution(baseResolution, setting.scale);
	if (![resolution.width, resolution.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= options.maxDimension)) {
		throw new Error(`Node resolution must be positive integers up to ${options.maxDimension}: ${resolution.width} × ${resolution.height}`);
	}
	return { width: resolution.width, height: resolution.height };
}

