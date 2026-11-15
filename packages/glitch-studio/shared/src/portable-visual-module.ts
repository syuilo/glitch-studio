import type { Asset } from '@gs/shared/types.ts';
import type { VisualModule } from '@gs/subsystems_visual-module_shared/types.ts';
import type { ProjectCustomShaderEffect } from './project/types.ts';

export type PortableVisualModuleSettings = {
	resolutionScale: number;
	maxPixels: number;
	/** nullは自動。requestAnimationFrameの周期に追加のFPS制限を設けない。 */
	fpsLimit: number | null;
};

export const DEFAULT_PORTABLE_VISUAL_MODULE_SETTINGS: PortableVisualModuleSettings = {
	resolutionScale: 1,
	maxPixels: 8_294_400,
	fpsLimit: null,
};

export type PortableVisualModule = {
	name: string;
	gsVersion: string;
	visualModule: VisualModule;
	customShaderEffects: ProjectCustomShaderEffect[];
	assets: (Omit<Asset, 'fileData'> & { fileDataBase64: string })[];
	/** CSSで高さが指定されない場合だけ使う。描画解像度は保存しない。 */
	aspectRatio: number;
	settings: PortableVisualModuleSettings;
	initialParameters: Record<string, unknown>;
};

export function validatePortableVisualModuleSettings(settings: PortableVisualModuleSettings): void {
	if (!Number.isFinite(settings.resolutionScale) || settings.resolutionScale <= 0) throw new Error('Resolution scale must be positive and finite');
	if (!Number.isSafeInteger(settings.maxPixels) || settings.maxPixels < 1) throw new Error('Maximum pixels must be a positive integer');
	if (settings.fpsLimit != null && (!Number.isFinite(settings.fpsLimit) || settings.fpsLimit <= 0)) throw new Error('FPS limit must be null (automatic) or positive and finite');
}
