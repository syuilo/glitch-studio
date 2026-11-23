import type { Asset } from '@gs/shared/types.ts';
import type { NodesEffect } from '@gs/subsystems_effect_shared/nodes-effect.ts';
import type { ProjectEffectRegistrations } from './project/types.ts';

export type PortableNodesEffectSettings = {
	resolutionScale: number;
	maxPixels: number;
	/** nullは自動。requestAnimationFrameの周期に追加のFPS制限を設けない。 */
	fpsLimit: number | null;
};

export const DEFAULT_PORTABLE_NODES_EFFECT_SETTINGS: PortableNodesEffectSettings = {
	resolutionScale: 1,
	maxPixels: 8_294_400,
	fpsLimit: null,
};

export type PortableNodesEffect = ProjectEffectRegistrations & {
	name: string;
	gsVersion: string;
	nodesEffect: NodesEffect;
	assets: (Omit<Asset, 'fileData'> & ({ fileDataBase64: string } | { fileDataPath: string }))[];
	/** CSSで高さが指定されない場合だけ使う。描画解像度は保存しない。 */
	aspectRatio: number;
	settings: PortableNodesEffectSettings;
	initialParameters: Record<string, unknown>;
};

export function validatePortableNodesEffectSettings(settings: PortableNodesEffectSettings): void {
	if (!Number.isFinite(settings.resolutionScale) || settings.resolutionScale <= 0) throw new Error('Resolution scale must be positive and finite');
	if (!Number.isSafeInteger(settings.maxPixels) || settings.maxPixels < 1) throw new Error('Maximum pixels must be a positive integer');
	if (settings.fpsLimit != null && (!Number.isFinite(settings.fpsLimit) || settings.fpsLimit <= 0)) throw new Error('FPS limit must be null (automatic) or positive and finite');
}
