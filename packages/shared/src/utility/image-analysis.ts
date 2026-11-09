import type { ImageValueScale } from './image-value-scale.ts';

/** GPUへ渡す番号はgpu/image-analysis.wgslの分岐と対応する。 */
export const IMAGE_ANALYSIS_MODES = ['rgb', 'luminance', 'alpha', 'vectorX', 'vectorY', 'vectorLength'] as const;
export type ImageAnalysisMode = (typeof IMAGE_ANALYSIS_MODES)[number];
/** Luminanceは作品内のWaveformエフェクトが持つ表示方式。プレビューの選択肢には含めない。 */
export type ImageAnalysisTarget = Exclude<ImageAnalysisMode, 'luminance'>;

const COLOR_VALUE_SCALES = ['srgb', 'linear', 'ev'] as const;
const DATA_VALUE_SCALES = ['linear'] as const;

export function getImageAnalysisValueScales(mode: ImageAnalysisMode): readonly ImageValueScale[] {
	return mode === 'rgb' || mode === 'luminance' ? COLOR_VALUE_SCALES : DATA_VALUE_SCALES;
}

/** alphaやベクトルへ色の伝達関数が混入しないよう、UIとGPUへの設定境界の両方で使う。 */
export function resolveImageAnalysisValueScale(mode: ImageAnalysisMode, valueScale: ImageValueScale): ImageValueScale {
	return getImageAnalysisValueScales(mode).includes(valueScale) ? valueScale : 'linear';
}
