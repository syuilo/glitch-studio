import { TIMELINE_FRAME } from '@gs/subsystems_timeline_shared/spatial.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { TimelineBounds } from '@gs/subsystems_timeline_shared/spatial.ts';

/**
 * 素材の基準枠と、その枠の外側を含む実際の画素範囲。GPU共通の値型には持ち込まない。
 * regionのない素材はテクスチャ寸法を基準とする。合成後は画素を借用する場合も
 * Scene基準のregionを付け、親や後続レイヤーが素材としてFitし直すことを防ぐ。
 */
export type TimelineImage = UniformOrTexture & { region?: { bounds: TimelineBounds; frameSize: Resolution } };
export function timelineImageBounds(image: TimelineImage): TimelineBounds { return image.region?.bounds ?? TIMELINE_FRAME; }
export function timelineImageFrame(image: TimelineImage, fallback: Resolution): Resolution {
	return image.region?.frameSize ?? (image.kind === 'texture' ? { width: image.texture.width, height: image.texture.height } : fallback);
}

/** 巨大な空間をGPU寸法へ直結させず、座標範囲を保って画素密度を制限する。 */
export function timelineTextureSize(bounds: TimelineBounds, frame: Resolution, maxDimension: number): Resolution {
	if (!Object.values(bounds).every(value => Number.isFinite(Math.fround(value))) || bounds.left >= bounds.right || bounds.bottom >= bounds.top) {
		throw new RangeError('Timeline image bounds must be finite and non-empty');
	}
	const width = Math.max(1, Math.ceil((bounds.right - bounds.left) * frame.width / 2));
	const height = Math.max(1, Math.ceil((bounds.top - bounds.bottom) * frame.height / 2));
	// 画面外の拡張領域だけを制限する。8Kなどの基準Scene自体をこの予算で縮めると、
	// 指定した書き出し解像度の細部が失われるため、最低でも基準フレーム分を確保する。
	const framePixels = frame.width * frame.height;
	const pixelBudget = Math.max(framePixels, Math.min(16_777_216, framePixels * 4));
	const scale = Math.min(1, maxDimension / width, maxDimension / height, Math.sqrt(pixelBudget / (width * height)));
	return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
