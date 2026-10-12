import { scaleConfiguredResolution, type Resolution } from '@gs/shared/resolution.js';

export type TimelineSceneResolution =
	| { mode: 'project' }
	| { mode: 'customAbsolute'; width: number; height: number };

export function validateSceneResolution(setting: TimelineSceneResolution): void {
	const diagnostics = inspectSceneResolution(setting);
	if (diagnostics.length) throw new Error(diagnostics[0].message);
}

export function inspectSceneResolution(setting: TimelineSceneResolution): import('@gs/shared/validation/diagnostic.ts').ValidationDiagnostic[] {
	return setting?.mode === 'project' || (setting?.mode === 'customAbsolute' && [setting.width, setting.height].every(value => Number.isSafeInteger(value) && value > 0))
		? [] : [{ code: 'scene.resolution', message: 'Scene resolution must be project or custom with positive integer dimensions' }];
}

/** projectは親Sceneではなく、プロジェクト自身の基準寸法を参照する。 */
export function getSceneBaseResolution(setting: TimelineSceneResolution, projectResolution: Resolution): Resolution {
	const { width, height } = setting.mode === 'customAbsolute' ? setting : projectResolution;
	return { width, height };
}

/** 検証済み設定から寸法を計算する。GPU上限は環境・設定の更新時に検査する。 */
export function resolveSceneResolution(setting: TimelineSceneResolution, projectResolution: Resolution, scale: number): Resolution {
	return scaleConfiguredResolution(getSceneBaseResolution(setting, projectResolution), scale);
}
