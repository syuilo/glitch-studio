import { scaleResolution } from '@gs/shared/resolution.ts';
import type { Resolution } from '@gs/shared/resolution.ts';

export type TimelineEffectResolution =
	| { mode: 'context' | 'auto'; scale: number }
	| { mode: 'customAbsolute'; width: number; height: number };

export function validateTimelineEffectLayerResolution(setting: TimelineEffectResolution): void {
	switch (setting?.mode) {
		case 'context': case 'auto':
			if (!Number.isFinite(setting.scale) || setting.scale <= 0) throw new Error('Effect layer resolution scale must be positive and finite');
			break;
		case 'customAbsolute':
			if (![setting.width, setting.height].every(size => Number.isSafeInteger(size) && size > 0)) throw new Error('Effect layer dimensions must be positive integers');
			break;
		default: throw new Error('Invalid effect layer resolution mode');
	}
}

/** Scene枠に合わせた入力と描画基準には全体倍率が適用済み。絶対指定の保存寸法だけに全体倍率を掛ける。 */
export function resolveTimelineEffectLayerResolution(setting: TimelineEffectResolution, sceneResolution: Resolution, resolutionScale: number): Resolution {
	validateTimelineEffectLayerResolution(setting);
	const resolution = setting.mode === 'customAbsolute' ? scaleResolution(setting, resolutionScale) : scaleResolution(sceneResolution, setting.scale);
	if (!Number.isSafeInteger(resolution.width) || !Number.isSafeInteger(resolution.height)) throw new Error('Invalid effective layer resolution');
	return resolution;
}
