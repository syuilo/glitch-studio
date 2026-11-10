import type { ImageAnalysisTarget } from '@gs/shared/utility/image-analysis.ts';
import type { ImageValueRange, ImageValueScale } from '@gs/shared/utility/image-value-scale.ts';
import type { Resolution } from '@gs/shared/resolution.ts';

export type PreviewWaveformCanvasSizes = {
	horizontal: Resolution;
	vertical: Resolution;
};

/** プレビューの解析表示。作品・エフェクトの設定には保存しない。 */
export type PreviewImageAnalysisSettings = {
	target: ImageAnalysisTarget;
	valueScale: ImageValueScale;
	valueRange: ImageValueRange;
	// 表示領域がまだない呼び出し元では、描画先Canvasの現在の寸法を使う。
	waveformCanvasSizes: PreviewWaveformCanvasSizes | null;
};
