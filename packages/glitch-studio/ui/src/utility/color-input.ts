import { linearSrgbToOklch, linearSrgbToSrgb, OKLCH_POWERLESS_CHROMA, srgbToLinearSrgb } from '@gs/shared/color-space.ts';
import type { LinearSrgbColor } from '@gs/shared/color-space.ts';

export type RgbaColor = LinearSrgbColor;

export function clampColorValue(value: number): number {
	return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function normalizeColor(color: readonly number[]): RgbaColor {
	// 保存値はlinear。ピッカーを開く・alphaだけを編集する操作でHDRや負値を失わない。
	return [Number.isFinite(color[0]) ? color[0] : 0, Number.isFinite(color[1]) ? color[1] : 0, Number.isFinite(color[2]) ? color[2] : 0, clampColorValue(color[3] ?? 1)];
}

export function colorCss(color: readonly number[]): string {
	const [r, g, b, a] = linearSrgbToSrgb(normalizeColor(color)).map(clampColorValue);
	// 伝達関数の往復で生じる微小な丸め誤差を、CSSの表示文字列へ持ち込まない。
	const channel = (value: number) => Number((value * 255).toFixed(6));
	return `rgb(${channel(r)} ${channel(g)} ${channel(b)} / ${a})`;
}

/** 色域の判定基準と表示先を分離する。広色域の色見本はブラウザーの色管理へ渡す。 */
export function extendedColorCss(color: readonly number[]): string {
	const [r, g, b, a] = normalizeColor(color);
	return `color(srgb-linear ${r} ${g} ${b} / ${a})`;
}

export function colorHex(color: readonly number[]): string {
	return '#' + linearSrgbToSrgb(normalizeColor(color)).map(channel => Math.round(clampColorValue(channel) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function parseColorHex(text: string, alpha: number): RgbaColor | null {
	let hex = text.trim().replace(/^#/, '');
	if (!/^(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(hex)) return null;
	if (hex.length <= 4) hex = [...hex].map(c => c + c).join('');
	return srgbToLinearSrgb([parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255, hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : alpha]);
}

export function rgbToHsv(color: RgbaColor, previousHue: number): [number, number, number] {
	const [r, g, b] = linearSrgbToSrgb(color).map(clampColorValue);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;
	// 無彩色でも直前の色相を保持し、彩度を戻したときに同じ色相を使う。
	const hue = delta === 0 ? previousHue : ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360;
	return [hue, max === 0 ? 0 : delta / max, max];
}

export function rgbToOklch(color: RgbaColor, previousHue: number): [number, number, number] {
	const [lightness, chroma, hue] = linearSrgbToOklch(color);
	// 無彩色の丸め誤差から色相を作らず、Cを戻したときに直前の色相で編集を続けられるようにする。
	return chroma <= OKLCH_POWERLESS_CHROMA ? [lightness, 0, previousHue] : [lightness, chroma, hue];
}

export function hsvToRgb(hue: number, saturation: number, value: number, alpha: number): RgbaColor {
	const channel = (offset: number) => {
		const k = (offset + hue / 60) % 6;
		return value * (1 - saturation * Math.max(0, Math.min(k, 4 - k, 1)));
	};
	return srgbToLinearSrgb([channel(5), channel(3), channel(1), alpha]);
}

export function hsvToHsl(hue: number, saturation: number, value: number): [number, number, number] {
	const lightness = value * (1 - saturation / 2);
	return [hue, lightness === 0 || lightness === 1 ? 0 : (value - lightness) / Math.min(lightness, 1 - lightness), lightness];
}
