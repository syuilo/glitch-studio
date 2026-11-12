import type { ImageValueRange } from '@gs/shared/utility/image-value-scale.ts';
import type { PreviewImageAnalysisViewport } from './preview-image-analysis-viewport.ts';

export type PreviewWaveformViewports = { horizontal: PreviewImageAnalysisViewport; vertical: PreviewImageAnalysisViewport };

/** UIの目盛りとGPUの切り出しが同じ方向・範囲を参照するための境界。 */
export function getPreviewWaveformViewportRanges(direction: 'horizontal' | 'vertical', viewport: PreviewImageAnalysisViewport): { positionRange: ImageValueRange; valueWindow: ImageValueRange } {
	return direction === 'horizontal' ? {
		positionRange: { minimum: viewport.x, maximum: Math.min(1, viewport.x + viewport.width) },
		valueWindow: { minimum: Math.max(0, 1 - viewport.y - viewport.height), maximum: 1 - viewport.y },
	} : {
		positionRange: { minimum: viewport.y, maximum: Math.min(1, viewport.y + viewport.height) },
		valueWindow: { minimum: viewport.x, maximum: Math.min(1, viewport.x + viewport.width) },
	};
}
