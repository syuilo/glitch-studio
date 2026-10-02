import { scaleResolution } from '@glitch/shared/resolution.js';

export type TimelineSceneResolution =
	| { mode: 'project' }
	| { mode: 'customAbsolute'; width: number; height: number };

export function validateSceneResolution(setting: TimelineSceneResolution): void {
	if (setting?.mode === 'project') return;
	if (setting?.mode !== 'customAbsolute' || ![setting.width, setting.height].every(value => Number.isSafeInteger(value) && value > 0)) {
		throw new Error('Scene resolution must be project or custom with positive integer dimensions');
	}
}

/** projectは親Sceneではなく、プロジェクト自身の基準寸法を参照する。 */
export function getSceneBaseResolution(setting: TimelineSceneResolution, projectResolution: Resolution): Resolution {
	validateSceneResolution(setting);
	const { width, height } = setting.mode === 'customAbsolute' ? setting : projectResolution;
	return { width, height };
}

/** 入れ子でも各基準寸法に一度だけ倍率を適用し、GPU確保前に上限を検証する。 */
export function resolveSceneResolution(setting: TimelineSceneResolution, projectResolution: Resolution, scale: number, maxDimension: number): Resolution {
	const resolution = scaleResolution(getSceneBaseResolution(setting, projectResolution), scale);
	if (resolution.width > maxDimension || resolution.height > maxDimension) {
		throw new Error(`Scene resolution exceeds ${maxDimension}: ${resolution.width} × ${resolution.height}`);
	}
	return resolution;
}
