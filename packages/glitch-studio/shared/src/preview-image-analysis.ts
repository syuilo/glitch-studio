import type { ImageAnalysisTarget } from '@gs/shared/utility/image-analysis.ts';
import type { ImageValueRange, ImageValueScale } from '@gs/shared/utility/image-value-scale.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { PreviewWaveformViewports } from './preview-waveform-viewport.ts';

export type PreviewWaveformCanvasSizes = {
	horizontal: Resolution;
	vertical: Resolution;
};

export type PreviewWaveformDisplaySettings = {
	// 表示領域がまだない呼び出し元では、描画先Canvasの現在の寸法を使う。
	waveformCanvasSizes: PreviewWaveformCanvasSizes | null;
	waveformViewports: PreviewWaveformViewports | null;
};

/** プレビューの解析表示。作品・エフェクトの設定には保存しない。 */
export type PreviewImageAnalysisSettings = PreviewWaveformDisplaySettings & {
	target: ImageAnalysisTarget;
	valueScale: ImageValueScale;
	valueRange: ImageValueRange;
};
