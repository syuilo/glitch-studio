import { scaleResolution, type Resolution } from '@glitch/shared/resolution.ts';
import type { EffectNodeResolution } from '@glitch/shared/visual-module/types.ts';

/** GPUに触れずサイズを解決する。project/inputは計算用、intrinsic/customは倍率適用前の寸法。 */
export function resolveEffectNodeResolution(options: {
	setting: EffectNodeResolution;
	projectResolution: Resolution;
	resolutionScale: number;
	intrinsicResolution?: Resolution;
	inputResolution?: Resolution;
	maxDimension: number;
}): Resolution {
	const { setting } = options;
	const resolution = setting.mode === 'custom' ? scaleResolution(setting, options.resolutionScale)
		: setting.mode === 'project' ? options.projectResolution
		: options.intrinsicResolution != null ? scaleResolution(options.intrinsicResolution, options.resolutionScale)
		: options.inputResolution ?? options.projectResolution;
	if (![resolution.width, resolution.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= options.maxDimension)) {
		throw new Error(`Node resolution must be positive integers up to ${options.maxDimension}: ${resolution.width} × ${resolution.height}`);
	}
	return { width: resolution.width, height: resolution.height };
}
