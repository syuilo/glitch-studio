import { linearChannelToSrgb, oklabToLinearSrgb, oklchToLinearSrgb } from '@gs/shared/color-space.ts';
import { colorCss } from './color-input.ts';
import { getLinearSrgbGamutStatus } from '@gs/shared/rgb-gamut.ts';
import type { RgbGamut } from '@gs/shared/rgb-gamut.ts';

/** 数値入力の上限ではなく、OKLCHマップが表示する横軸の範囲。 */
export const OKLCH_MAP_MAX_CHROMA = 0.5;

export const COLOR_PICKER_GAMUT_LABELS: Record<RgbGamut, string> = {
	srgb: 'sRGB', displayP3: 'Display P3', rec2020: 'Rec.2020', adobeRgb: 'Adobe RGB', acescg: 'ACEScg',
};

// 無彩色・黒・白でも色相を選べるよう、色相バーの見本は固定のL・Cを使う。
// CSSのgamut mappingに任せず、マップ・数値欄と同じlinear RGBの表示経路を通す。
export const OKLCH_HUE_GRADIENT = `linear-gradient(to right, ${Array.from({ length: 25 }, (_, index) => colorCss(oklchToLinearSrgb([0.7, 0.1, index * 15, 1]))).join(', ')})`;

/** 固定色相のC×L平面。原色範囲外は斜線、基準値1超は点で区別して拡張sRGBへencodeする。 */
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
			const status = getLinearSrgbGamutStatus(color, gamut);
			const stripe = (x + y) % 12;
			const dotX = x % 10;
			const dotY = y % 10;
			const offset = (y * width + x) * 4;
			for (let channel = 0; channel < 3; channel++) {
				// 負値・1超もfloat Canvasへ渡し、モニターへの変換より前にはclampしない。
				let displayValue = linearChannelToSrgb(color[channel]);
				// 明暗どちらの色でも見える二重の斜線。HDRだけを理由に斜線を付けない。
				if (status.outsidePrimaries && stripe < 4) displayValue = displayValue * 0.65 + (stripe < 2 ? 0 : 1) * 0.35;
				// RGB上限の通知は独立した点模様。負値と1超が同時にある画素では両方を重ねる。
				if (status.aboveReferenceRange && dotX < 3 && dotY < 3) displayValue = displayValue * 0.35 + (dotX === 1 && dotY === 1 ? 1 : 0) * 0.65;
				pixels[offset + channel] = displayValue;
			}
			pixels[offset + 3] = 1;
		}
	}
	return pixels;
}
