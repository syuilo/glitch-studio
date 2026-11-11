import type { RgbGamut } from '@gs/shared/rgb-gamut.ts';

/** 表示機器の推定色域ではなく、作品を比較するために明示的に選ぶSDRの判定色域。 */
export const PREVIEW_GAMUT_WARNING_REFERENCE_GAMUTS = ['srgb', 'displayP3', 'rec2020', 'adobeRgb'] as const satisfies readonly RgbGamut[];
export type PreviewGamutWarningReferenceGamut = typeof PREVIEW_GAMUT_WARNING_REFERENCE_GAMUTS[number];

/** 両プレビュー共通の表示専用設定。作品・書き出し・色域圧縮の設定とは独立する。 */
export type PreviewGamutWarningSettings = {
	enabled: boolean;
	referenceGamut: PreviewGamutWarningReferenceGamut;
};
