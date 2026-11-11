import type { PreviewGamutCompressionSettings } from './preview-gamut-compression.ts';

/** 背景・警告・出力先を含まない画像の表示調整。保持フレームの再解析にも同じ値を渡す。 */
export type PreviewImageAdjustmentSettings = {
	exposure: number;
	srgbProof: boolean;
	gamutCompression: PreviewGamutCompressionSettings;
};
