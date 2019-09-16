import * as blend from 'color-blend';
import { fx, Pixel } from '../core';
import seedrandom from 'seedrandom';

const paramDef = {
	times: {
		type: 'range',
		default: 128
	},
	size: {
		type: 'range',
		default: 8
	},
	range: {
		type: 'range',
		default: 128
	},
	pos: {
		type: 'range',
		default: 0
	},
	rgb: {
		type: 'bool',
		default: true
	},
	cmy: {
		type: 'bool',
		default: true
	},
	black: {
		type: 'bool',
		default: true
	},
	white: {
		type: 'bool',
		default: true
	},
	blendMode: {
		type: 'blendMode',
		default: 'normal'
	},
	seed: {
		type: 'number',
		default: 0,
	}
};

const fn = fx(paramDef, (w, h, get, set, params) => {
	const { times, size, range, pos, rgb, cmy, black, white, blendMode, seed } = params;

	const rnd = seedrandom(seed.toString());

	const colors = [] as Pixel[];

	if (rgb) {
		colors.push([255, 0, 0]);
		colors.push([0, 255, 0]);
		colors.push([0, 0, 255]);
	}

	if (cmy) {
		colors.push([255, 255, 0]);
		colors.push([255, 0, 255]);
		colors.push([0, 255, 255]);
	}

	if (black) {
		colors.push([0, 0, 0]);
	}

	if (white) {
		colors.push([255, 255, 255]);
	}

	for (let _ = 0; _ < times; _++) {
		let blockX = Math.floor(rnd() * w);
		let blockY = Math.floor(rnd() * range) + pos;

		// Snap
		blockX = Math.round(blockX / size) * size;
		blockY = Math.round(blockY / size) * size;

		const color = colors[Math.floor(rnd() * colors.length)];

		const xOver = Math.max(0, (blockX + size) - w);
		const yOver = Math.max(0, (blockY + size) - h);

		for (let x = 0; x < size - xOver; x++) {
			const dstX = blockX + x;
			for (let y = 0; y < size - yOver; y++) {
				const dstY = blockY + y;
				if (blendMode === 'normal') {
					set(dstX, dstY, color);
				} else {
					const [dstR, dstG, dstB] = get(dstX, dstY);
					const { r, g, b } = (blend as any)[blendMode]({
						r: dstR,
						g: dstG,
						b: dstB,
						a: 255
					}, {
						r: color[0],
						g: color[1],
						b: color[2],
						a: 255
					});
					set(dstX, dstY, [r, g, b]);
				}
			}
		}
	}
});

export default {
	name: 'colorBlocks',
	displayName: 'Color blocks',
	paramDef,
	fn
};