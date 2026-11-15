import type { PortableVisualModule, PortableVisualModuleSettings } from '@gs/glitch-studio_shared/portable-visual-module.ts';
import type { Resolution } from '@gs/shared/resolution.ts';

export type PortableVisualModuleFrame = {
	resolution: Resolution;
	time: number;
	pointerElementPosition: { x: number; y: number } | null;
	parameters: Record<string, unknown>;
	resetHistory: boolean;
};

export type PortableVisualModuleRequest =
	| { type: 'initialize'; canvas: OffscreenCanvas; artwork: PortableVisualModule }
	| { type: 'frame'; frame: PortableVisualModuleFrame }
	| { type: 'dispose' };

export type PortableVisualModuleResponse =
	| { type: 'ready' }
	| { type: 'frame'; resolution: Resolution; time: number }
	| { type: 'error'; message: string };

/** GPU限界でも片軸だけを切り詰めず、公開座標の縦横比を維持する。 */
export function getPortableRenderResolution(width: number, height: number, settings: PortableVisualModuleSettings, maxDimension = Infinity): Resolution | null {
	if (!(width > 0) || !(height > 0)) return null;
	const scale = Math.min(settings.resolutionScale, Math.sqrt(settings.maxPixels / width / height), maxDimension / width, maxDimension / height);
	const resolution = { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
	// 極端に細長い領域では短辺を1pxへ丸めた分だけ上限を超える。残る長辺で予算を守る。
	if (resolution.width * resolution.height > settings.maxPixels) {
		if (resolution.width >= resolution.height) resolution.width = Math.max(1, Math.floor(settings.maxPixels / resolution.height));
		else resolution.height = Math.max(1, Math.floor(settings.maxPixels / resolution.width));
	}
	return resolution;
}

/** containの余白を含む要素内位置から、レンダラー境界の各軸[-1,+1]へ換算する。 */
export function getPortablePointerPosition(position: { x: number; y: number } | null, resolution: Resolution, outputResolution: Resolution) {
	if (position == null) return { x: -99999, y: -99999 };
	const aspectRatio = outputResolution.width / outputResolution.height;
	const width = Math.min(resolution.width, resolution.height * aspectRatio);
	const height = width / aspectRatio;
	return {
		x: (position.x * resolution.width - (resolution.width - width) / 2) / width * 2 - 1,
		y: 1 - (position.y * resolution.height - (resolution.height - height) / 2) / height * 2,
	};
}
