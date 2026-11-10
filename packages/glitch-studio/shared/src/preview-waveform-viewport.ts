import type { ImageValueRange } from '@gs/shared/utility/image-value-scale.ts';

/** 波形全体を0〜1とする表示範囲。原点は左上で、表示倍率とは独立して保持する。 */
export type PreviewWaveformViewport = { x: number; y: number; width: number; height: number };
export type PreviewWaveformViewports = { horizontal: PreviewWaveformViewport; vertical: PreviewWaveformViewport };

export const FULL_PREVIEW_WAVEFORM_VIEWPORT: Readonly<PreviewWaveformViewport> = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

/** UIの目盛りとGPUの切り出しが同じ方向・範囲を参照するための境界。 */
export function getPreviewWaveformViewportRanges(direction: 'horizontal' | 'vertical', viewport: PreviewWaveformViewport): { positionRange: ImageValueRange; valueWindow: ImageValueRange } {
	return direction === 'horizontal' ? {
		positionRange: { minimum: viewport.x, maximum: Math.min(1, viewport.x + viewport.width) },
		valueWindow: { minimum: Math.max(0, 1 - viewport.y - viewport.height), maximum: 1 - viewport.y },
	} : {
		positionRange: { minimum: viewport.y, maximum: Math.min(1, viewport.y + viewport.height) },
		valueWindow: { minimum: viewport.x, maximum: Math.min(1, viewport.x + viewport.width) },
	};
}
