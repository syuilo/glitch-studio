import { Pixel } from './core';

export function blend(dst: Pixel, src: Pixel, mix: number): Pixel {
	const _mix = Math.floor(mix * 255);
	let r = (src[0] * _mix + dst[0] * (255 - _mix)) / 255;
	let g = (src[1] * _mix + dst[1] * (255 - _mix)) / 255;
	let b = (src[2] * _mix + dst[2] * (255 - _mix)) / 255;
	return [r, g, b];
}
