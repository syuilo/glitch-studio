import { createOklchGamutBoundary } from '@gs/shared/rgb-gamut.ts';
import type { RgbGamut } from '@gs/shared/rgb-gamut.ts';
import { PREVIEW_GAMUT_COMPRESSION_PRESETS } from '@gs/glitch-studio_shared/preview-gamut-compression.ts';
import type { PreviewGamutCompressionMode } from '@gs/glitch-studio_shared/preview-gamut-compression.ts';

export const PREVIEW_GAMUT_HUE_STEPS = 720;
export const PREVIEW_GAMUT_LIGHTNESS_STEPS = 256;
// 各点はsRGBに続けて全プリセットの境界を持つ。vec4の成分数へ色域数を固定しない。
const PREVIEW_GAMUT_LOOKUP_GAMUTS = ['srgb', ...PREVIEW_GAMUT_COMPRESSION_PRESETS] as const;
export const PREVIEW_GAMUT_COUNT = PREVIEW_GAMUT_LOOKUP_GAMUTS.length;

/**
 * 同一のOKLCH明度・色相における、指定色域の最大クロマ。
 * OKLCH上の色域断面は常に星形ではない。特にRec.2020の青は、灰色からの
 * 二分探索だけでは途中の色域外区間へ突き当たり、本来の青の頂点を失う。
 * RGB各成分がCの三次式になることを使い、6面との全交点から最も外側を選ぶ。
 */
export function getPreviewGamutMaximumChroma(lightness: number, hue: number, gamut: RgbGamut): number {
	return createOklchGamutBoundary(hue / Math.PI * 180, gamut)(lightness);
}

let boundaryLookup: Float32Array | null = null;

/**
 * 各点はsRGB・全プリセットの最大クロマを順に持つ、点ごとのスカラー配列。
 * 境界探索を毎画素・毎フレーム行わないため、Worker内で一度だけ計算して共有する。
 * 色相の末尾には先頭を複製し、0/360度をまたぐ補間にも継ぎ目を作らない。
 */
export function getPreviewGamutBoundaryLookup(): Float32Array {
	if (boundaryLookup != null) return boundaryLookup;
	const width = PREVIEW_GAMUT_HUE_STEPS + 1;
	const values = new Float32Array(width * (PREVIEW_GAMUT_LIGHTNESS_STEPS + 1) * PREVIEW_GAMUT_COUNT);
	for (let hueIndex = 0; hueIndex < PREVIEW_GAMUT_HUE_STEPS; hueIndex++) {
		const hue = hueIndex / PREVIEW_GAMUT_HUE_STEPS * 360;
		// ピッカーの上限なし判定とは用途が異なる。圧縮は全色域でRGBの0〜1を基準にする。
		const boundaries = PREVIEW_GAMUT_LOOKUP_GAMUTS.map(gamut => createOklchGamutBoundary(hue, gamut, 'unit'));
		for (let lightnessIndex = 1; lightnessIndex < PREVIEW_GAMUT_LIGHTNESS_STEPS; lightnessIndex++) {
			const lightness = lightnessIndex / PREVIEW_GAMUT_LIGHTNESS_STEPS;
			const offset = (lightnessIndex * width + hueIndex) * PREVIEW_GAMUT_COUNT;
			for (const [channel, boundary] of boundaries.entries()) values[offset + channel] = boundary(lightness);
		}
	}
	for (let lightnessIndex = 1; lightnessIndex < PREVIEW_GAMUT_LIGHTNESS_STEPS; lightnessIndex++) {
		const first = lightnessIndex * width * PREVIEW_GAMUT_COUNT;
		values.set(values.subarray(first, first + PREVIEW_GAMUT_COUNT), first + PREVIEW_GAMUT_HUE_STEPS * PREVIEW_GAMUT_COUNT);
	}
	boundaryLookup = values;
	return values;
}

export function getPreviewGamutCompressionModeIndex(mode: PreviewGamutCompressionMode): number {
	// 0は通常表示、1〜NはプリセットとLUT成分の番号、N+1はLUTを使わないカスタム。
	if (mode === 'none') return 0;
	if (mode === 'custom') return PREVIEW_GAMUT_COUNT;
	return PREVIEW_GAMUT_COMPRESSION_PRESETS.indexOf(mode) + 1;
}
