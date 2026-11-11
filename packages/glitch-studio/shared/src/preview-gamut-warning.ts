import type { RgbGamut, RgbGamutBounds } from '@gs/shared/rgb-gamut.ts';

/** 表示機器の推定色域ではなく、作品を比較するために明示的に選ぶ判定色域。 */
export const PREVIEW_GAMUT_WARNING_REFERENCE_GAMUTS = ['srgb', 'displayP3', 'rec2020', 'adobeRgb', 'acescg'] as const satisfies readonly RgbGamut[];
export type PreviewGamutWarningReferenceGamut = typeof PREVIEW_GAMUT_WARNING_REFERENCE_GAMUTS[number];

/** 原色の範囲と0〜1の基準レンジを分け、HDR画像にも上限なしの判定を使えるようにする。 */
export const PREVIEW_GAMUT_WARNING_BOUNDS = ['nonNegative', 'unit'] as const satisfies readonly RgbGamutBounds[];

/** 両プレビュー共通の表示専用設定。作品・書き出し・色域圧縮の設定とは独立する。 */
export type PreviewGamutWarningSettings = {
	enabled: boolean;
	referenceGamut: PreviewGamutWarningReferenceGamut;
	/** nonNegativeは負の成分のみ、unitは負値と基準値1超を調べる。ACEScgの有効値の定義ではない。 */
	bounds: RgbGamutBounds;
};
