export type RgbaColor = [number, number, number, number];

export function clampColorValue(value: number): number {
	return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function normalizeColor(color: readonly number[]): RgbaColor {
	return [clampColorValue(color[0]), clampColorValue(color[1]), clampColorValue(color[2]), clampColorValue(color[3] ?? 1)];
}

export function colorCss(color: readonly number[]): string {
	const [r, g, b, a] = normalizeColor(color);
	return `rgb(${r * 255} ${g * 255} ${b * 255} / ${a})`;
}

export function colorHex(color: readonly number[]): string {
	return '#' + color.map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function parseColorHex(text: string, alpha: number): RgbaColor | null {
	let hex = text.trim().replace(/^#/, '');
	if (!/^(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(hex)) return null;
	if (hex.length <= 4) hex = [...hex].map(c => c + c).join('');
	return [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255, hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : alpha];
}

export function rgbToHsv(color: RgbaColor, previousHue: number): [number, number, number] {
	const [r, g, b] = color;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;
	// 無彩色でも直前の色相を保持し、彩度を戻したときに同じ色相を使う。
	const hue = delta === 0 ? previousHue : ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360;
	return [hue, max === 0 ? 0 : delta / max, max];
}

export function hsvToRgb(hue: number, saturation: number, value: number, alpha: number): RgbaColor {
	const channel = (offset: number) => {
		const k = (offset + hue / 60) % 6;
		return value * (1 - saturation * Math.max(0, Math.min(k, 4 - k, 1)));
	};
	return [channel(5), channel(3), channel(1), alpha];
}

export function hsvToHsl(hue: number, saturation: number, value: number): [number, number, number] {
	const lightness = value * (1 - saturation / 2);
	return [hue, lightness === 0 || lightness === 1 ? 0 : (value - lightness) / Math.min(lightness, 1 - lightness), lightness];
}
