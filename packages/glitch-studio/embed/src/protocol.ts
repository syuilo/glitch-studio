import { normalizedToSpatialCoordinates } from '@gs/shared/spatial-coordinate.ts';
import type { PortableNodesEffect, PortableNodesEffectSettings } from '@gs/glitch-studio_shared/portable-nodes-effect.ts';
import type { Resolution } from '@gs/shared/resolution.ts';

export type PortableNodesEffectFrame = {
	resolution: Resolution;
	time: number;
	pointerElementPosition: { x: number; y: number } | null;
	/** 初回と公開値の変更時だけスナップショットを送る。 */
	parameters: Record<string, unknown> | null;
	resetHistory: boolean;
};

export type PortableNodesEffectRequest =
	| { type: 'initialize'; canvas: OffscreenCanvas; artwork: PortableNodesEffect; artworkModuleUrl: string | null }
	| { type: 'frame'; frame: PortableNodesEffectFrame }
	| { type: 'dispose' };

export type PortableNodesEffectResponse =
	| { type: 'ready' }
	| { type: 'frame'; resolution: Resolution; time: number }
	| { type: 'error'; message: string };

/** GPU限界でも片軸だけを切り詰めず、公開座標の縦横比を維持する。 */
export function getPortableRenderResolution(width: number, height: number, settings: PortableNodesEffectSettings, maxDimension = Infinity): Resolution | null {
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

/** containの余白を含む要素内位置から、配置の等方座標へ換算する。出力と寸法の異なる内部ノードへの換算はeffectに任せる。 */
export function getPortablePointerPosition(position: { x: number; y: number } | null, resolution: Resolution, outputResolution: Resolution) {
	if (position == null) return null;
	const aspectRatio = outputResolution.width / outputResolution.height;
	const width = Math.min(resolution.width, resolution.height * aspectRatio);
	const height = width / aspectRatio;
	return normalizedToSpatialCoordinates([
		(position.x * resolution.width - (resolution.width - width) / 2) / width * 2 - 1,
		1 - (position.y * resolution.height - (resolution.height - height) / 2) / height * 2,
	], resolution);
}
