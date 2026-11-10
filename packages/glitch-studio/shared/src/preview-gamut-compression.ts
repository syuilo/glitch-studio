/** 最終プレビューだけに適用する色域圧縮。作業色空間や書き出しの色空間は変更しない。 */
export type PreviewGamutCompressionMode = 'none' | 'displayP3' | 'rec2020' | 'adobeRgb' | 'custom';

export type PreviewGamutCompressionSettings = {
	mode: PreviewGamutCompressionMode;
	/** カスタムのクロマ削減率。0は無圧縮、0.5はクロマを半分、1は無彩色。 */
	customAmount: number;
};
