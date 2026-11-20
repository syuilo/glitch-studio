import type { Asset } from '@gs/shared/types.ts';
import type { CustomNodeGraphEffect } from '@gs/subsystems_effect-new_shared/custom-node-graph-effect.ts';
import type { ProjectEffectRegistrations } from './project/types.ts';

export type PortableCustomNodeGraphEffectSettings = {
	resolutionScale: number;
	maxPixels: number;
	/** nullは自動。requestAnimationFrameの周期に追加のFPS制限を設けない。 */
	fpsLimit: number | null;
};

export const DEFAULT_PORTABLE_CUSTOM_NODE_GRAPH_EFFECT_SETTINGS: PortableCustomNodeGraphEffectSettings = {
	resolutionScale: 1,
	maxPixels: 8_294_400,
	fpsLimit: null,
};

export type PortableCustomNodeGraphEffect = ProjectEffectRegistrations & {
	name: string;
	gsVersion: string;
	customNodeGraphEffect: CustomNodeGraphEffect;
	assets: (Omit<Asset, 'fileData'> & { fileDataBase64: string })[];
	/** CSSで高さが指定されない場合だけ使う。描画解像度は保存しない。 */
	aspectRatio: number;
	settings: PortableCustomNodeGraphEffectSettings;
	initialParameters: Record<string, unknown>;
};

export function validatePortableCustomNodeGraphEffectSettings(settings: PortableCustomNodeGraphEffectSettings): void {
	if (!Number.isFinite(settings.resolutionScale) || settings.resolutionScale <= 0) throw new Error('Resolution scale must be positive and finite');
	if (!Number.isSafeInteger(settings.maxPixels) || settings.maxPixels < 1) throw new Error('Maximum pixels must be a positive integer');
	if (settings.fpsLimit != null && (!Number.isFinite(settings.fpsLimit) || settings.fpsLimit <= 0)) throw new Error('FPS limit must be null (automatic) or positive and finite');
}
