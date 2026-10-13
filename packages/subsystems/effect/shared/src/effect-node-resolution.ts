import { scaleResolution, type Resolution } from '@gs/shared/resolution.ts';
import type { EffectResolution } from './resolution.ts';

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
	const resolution = setting.mode === 'customAbsolute' ? scaleResolution(setting, options.resolutionScale)
		: setting.mode === 'context' ? options.contextResolution
		: options.intrinsicResolution != null ? scaleResolution(options.intrinsicResolution, options.resolutionScale)
		: options.inputResolution ?? options.contextResolution;
	if (![resolution.width, resolution.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= options.maxDimension)) {
		throw new Error(`Node resolution must be positive integers up to ${options.maxDimension}: ${resolution.width} × ${resolution.height}`);
	}
	return { width: resolution.width, height: resolution.height };
}
