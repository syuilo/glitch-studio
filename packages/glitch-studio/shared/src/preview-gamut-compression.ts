/** 圧縮の基準となる色域。順番はGPUへ渡すモード番号とLUTの成分順にも使う。 */
export const PREVIEW_GAMUT_COMPRESSION_PRESETS = ['displayP3', 'rec2020', 'adobeRgb', 'acescg'] as const;

/** 最終プレビューだけに適用する色域圧縮。作業色空間や書き出しの色空間は変更しない。 */
export type PreviewGamutCompressionMode = 'none' | typeof PREVIEW_GAMUT_COMPRESSION_PRESETS[number] | 'custom';

export type PreviewGamutCompressionSettings = {
	mode: PreviewGamutCompressionMode;
	/** カスタムのクロマ削減率。0は無圧縮、0.5はクロマを半分、1は無彩色。 */
	customAmount: number;
};
