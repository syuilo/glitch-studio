import type { ImageAnalysisTarget } from '@gs/shared/utility/image-analysis.ts';
import type { ImageValueRange, ImageValueScale } from '@gs/shared/utility/image-value-scale.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { PreviewWaveformViewports } from './preview-waveform-viewport.ts';
import type { PreviewImageSource } from './preview-image-source.ts';
import type { PreviewImageAdjustmentSettings } from './preview-image-adjustment.ts';

/** 色の表示変換でAlphaやベクトルなどの数値データを変更しない。UIの選択値自体は保持する。 */
export function resolvePreviewAnalysisImageSource(target: ImageAnalysisTarget, imageSource: PreviewImageSource): PreviewImageSource {
	return target === 'rgb' ? imageSource : 'original';
}

export type PreviewWaveformCanvasSizes = {
	horizontal: Resolution;
	vertical: Resolution;
};

export type PreviewImageAnalysisDisplaySettings = {
	// 表示領域がまだない呼び出し元では、描画先Canvasの現在の寸法を使う。
	waveformCanvasSizes: PreviewWaveformCanvasSizes | null;
	waveformViewports: PreviewWaveformViewports | null;
	// 元の値域を0〜1へ正規化した後のX軸の表示範囲。nullは全体表示。
	histogramViewport: ImageValueRange | null;
};

/** プレビューの解析表示。作品・エフェクトの設定には保存しない。 */
export type PreviewImageAnalysisSettings = PreviewImageAnalysisDisplaySettings & {
	imageSource: PreviewImageSource;
	imageAdjustments: PreviewImageAdjustmentSettings;
	target: ImageAnalysisTarget;
	valueScale: ImageValueScale;
	valueRange: ImageValueRange;
};
