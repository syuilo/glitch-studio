import { Color } from './core';

export function blend(dst: Color, src: Color, mix: number): Color {
	const _mix = Math.floor(mix * 255);
	let r = (src[0] * _mix + dst[0] * (255 - _mix)) / 255;
	let g = (src[1] * _mix + dst[1] * (255 - _mix)) / 255;
	let b = (src[2] * _mix + dst[2] * (255 - _mix)) / 255;
	let a = (src[3] * _mix + dst[3] * (255 - _mix)) / 255;
	return [r, g, b, a];
}

export function getLuminance(color: Color) {
	return (color[0] * 0.299) + (color[1] * 0.587) + (color[2] * 0.114);
}

export function getBrightness(color: Color) {
	return ((color[0] + color[1] + color[2]) / (255 * 3)) * 255;
}
