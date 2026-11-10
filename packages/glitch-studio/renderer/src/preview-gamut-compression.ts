import { createOklchGamutBoundary, RGB_GAMUTS } from '@gs/shared/rgb-gamut.ts';
import type { RgbGamut } from '@gs/shared/rgb-gamut.ts';
import type { PreviewGamutCompressionMode } from '@gs/glitch-studio_shared/preview-gamut-compression.ts';

export const PREVIEW_GAMUT_HUE_STEPS = 720;
export const PREVIEW_GAMUT_LIGHTNESS_STEPS = 256;

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
 * 各点はsRGB・Display P3・Rec.2020・Adobe RGBの最大クロマを持つ。
 * 境界探索を毎画素・毎フレーム行わないため、Worker内で一度だけ計算して共有する。
 * 色相の末尾には先頭を複製し、0/360度をまたぐ補間にも継ぎ目を作らない。
 */
export function getPreviewGamutBoundaryLookup(): Float32Array {
	if (boundaryLookup != null) return boundaryLookup;
	const width = PREVIEW_GAMUT_HUE_STEPS + 1;
	const values = new Float32Array(width * (PREVIEW_GAMUT_LIGHTNESS_STEPS + 1) * 4);
	for (let hueIndex = 0; hueIndex < PREVIEW_GAMUT_HUE_STEPS; hueIndex++) {
		const hue = hueIndex / PREVIEW_GAMUT_HUE_STEPS * 360;
		const boundaries = RGB_GAMUTS.map(gamut => createOklchGamutBoundary(hue, gamut));
		for (let lightnessIndex = 1; lightnessIndex < PREVIEW_GAMUT_LIGHTNESS_STEPS; lightnessIndex++) {
			const lightness = lightnessIndex / PREVIEW_GAMUT_LIGHTNESS_STEPS;
			const offset = (lightnessIndex * width + hueIndex) * 4;
			for (const [channel, boundary] of boundaries.entries()) values[offset + channel] = boundary(lightness);
		}
	}
	for (let lightnessIndex = 1; lightnessIndex < PREVIEW_GAMUT_LIGHTNESS_STEPS; lightnessIndex++) {
		const first = lightnessIndex * width * 4;
		values.set(values.subarray(first, first + 4), first + PREVIEW_GAMUT_HUE_STEPS * 4);
	}
	boundaryLookup = values;
	return values;
}

export function getPreviewGamutCompressionModeIndex(mode: PreviewGamutCompressionMode): number {
	return { none: 0, displayP3: 1, rec2020: 2, adobeRgb: 3, custom: 4 }[mode];
}
