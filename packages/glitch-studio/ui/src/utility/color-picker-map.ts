import { linearChannelToSrgb, oklabToLinearSrgb, oklchToLinearSrgb } from '@gs/shared/color-space.ts';
import { colorCss } from './color-input.ts';
import { isLinearSrgbInGamut } from '@gs/shared/rgb-gamut.ts';
import type { RgbGamut } from '@gs/shared/rgb-gamut.ts';

/** 数値入力の上限ではなく、OKLCHマップが表示する横軸の範囲。 */
export const OKLCH_MAP_MAX_CHROMA = 0.5;

export const COLOR_PICKER_GAMUT_LABELS: Record<RgbGamut, string> = {
	srgb: 'sRGB', displayP3: 'Display P3', rec2020: 'Rec.2020', adobeRgb: 'Adobe RGB',
};

// 無彩色・黒・白でも色相を選べるよう、色相バーの見本は固定のL・Cを使う。
// CSSのgamut mappingに任せず、マップ・数値欄と同じlinear RGBの表示経路を通す。
export const OKLCH_HUE_GRADIENT = `linear-gradient(to right, ${Array.from({ length: 25 }, (_, index) => colorCss(oklchToLinearSrgb([0.7, 0.1, index * 15, 1]))).join(', ')})`;

/** 固定色相のC×L平面。拡張sRGBへencodeし、選択した基準色域の外側を斜線で区別する。 */
export function createOklchMapPixels(hue: number, width: number, height: number, gamut: RgbGamut): Float32Array {
	const pixels = new Float32Array(width * height * 4);
	const angle = hue / 180 * Math.PI;
	const hueCosine = Math.cos(angle);
	const hueSine = Math.sin(angle);
	for (let y = 0; y < height; y++) {
		const lightness = 1 - y / Math.max(1, height - 1);
		for (let x = 0; x < width; x++) {
			const chroma = x / Math.max(1, width - 1) * OKLCH_MAP_MAX_CHROMA;
			const color = oklabToLinearSrgb([lightness, chroma * hueCosine, chroma * hueSine, 1]);
			const outsideGamut = !isLinearSrgbInGamut(color, gamut);
			const stripe = (x + y) % 12;
			const offset = (y * width + x) * 4;
			for (let channel = 0; channel < 3; channel++) {
				// 負値・1超もfloat Canvasへ渡し、モニターへの変換より前にはclampしない。
				let displayValue = linearChannelToSrgb(color[channel]);
				// 明暗どちらの色でも見える二重の斜線。色域内の画素には手を加えない。
				if (outsideGamut && stripe < 4) displayValue = displayValue * 0.65 + (stripe < 2 ? 0 : 1) * 0.35;
				pixels[offset + channel] = displayValue;
			}
			pixels[offset + 3] = 1;
		}
	}
	return pixels;
}
