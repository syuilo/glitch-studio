import { linearChannelToSrgb, oklabToLinearSrgb, oklchToLinearSrgb } from '@gs/shared/color-space.ts';
import { colorCss } from './color-input.ts';

/** 数値入力の上限ではなく、OKLCHマップが表示する横軸の範囲。 */
export const OKLCH_MAP_MAX_CHROMA = 0.4;

// 無彩色・黒・白でも色相を選べるよう、色相バーの見本は固定のL・Cを使う。
// CSSのgamut mappingに任せず、マップ・数値欄と同じlinear RGBの表示経路を通す。
export const OKLCH_HUE_GRADIENT = `linear-gradient(to right, ${Array.from({ length: 25 }, (_, index) => colorCss(oklchToLinearSrgb([0.7, 0.1, index * 15, 1]))).join(', ')})`;

/** 固定した色相のC×L平面。表示用にだけsRGBへencode・clampし、色域外を斜線で区別する。 */
export function createOklchMapPixels(hue: number, width: number, height: number): Uint8ClampedArray {
	const pixels = new Uint8ClampedArray(width * height * 4);
	const angle = hue / 180 * Math.PI;
	const hueCosine = Math.cos(angle);
	const hueSine = Math.sin(angle);
	for (let y = 0; y < height; y++) {
		const lightness = 1 - y / Math.max(1, height - 1);
		for (let x = 0; x < width; x++) {
			const chroma = x / Math.max(1, width - 1) * OKLCH_MAP_MAX_CHROMA;
			const color = oklabToLinearSrgb([lightness, chroma * hueCosine, chroma * hueSine, 1]);
			// 基準白などの微小な変換誤差を色域外として表示しない。
			const outsideSrgb = color.slice(0, 3).some(channel => channel < -1e-6 || channel > 1 + 1e-6);
			const stripe = (x + y) % 12;
			const offset = (y * width + x) * 4;
			for (let channel = 0; channel < 3; channel++) {
				let displayValue = Math.min(1, Math.max(0, linearChannelToSrgb(color[channel]))) * 255;
				// 明暗どちらの色でも見える二重の斜線。色域内の画素には手を加えない。
				if (outsideSrgb && stripe < 4) displayValue = displayValue * 0.65 + (stripe < 2 ? 0 : 255) * 0.35;
				pixels[offset + channel] = displayValue;
			}
			pixels[offset + 3] = 255;
		}
	}
	return pixels;
}
