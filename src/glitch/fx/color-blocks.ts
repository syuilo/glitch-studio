import * as blend from 'color-blend';
import { fx, Color, basicParamDefs } from '../core';
import seedrandom from 'seedrandom';

const paramDefs = {
	times: {
		label: 'Times',
		type: 'range' as const,
		default: { type: 'literal' as const, value: 128 }
	},
	size: {
		label: 'Size',
		type: 'range' as const,
		default: { type: 'literal' as const, value: 64 }
	},
	rgb: {
		label: 'RGB',
		type: 'bool' as const,
		default: { type: 'literal' as const, value: true }
	},
	cmy: {
		label: 'CMY',
		type: 'bool' as const,
		default: { type: 'literal' as const, value: true }
	},
	black: {
		label: 'Black',
		type: 'bool' as const,
		default: { type: 'literal' as const, value: true }
	},
	white: {
		label: 'White',
		type: 'bool' as const,
		default: { type: 'literal' as const, value: true }
	},
	seed: {
		label: 'Seed',
		type: 'number' as const,
		default: { type: 'literal' as const, value: 0 },
	},

	...basicParamDefs,
};

const fn = fx((w, h, get, set, params) => {
	const { times, size, rgb, cmy, black, white, seed } = params;

	const rnd = seedrandom(seed.toString());

	const colors = [] as Color[];

	if (rgb) {
		colors.push([255, 0, 0, 255]);
		colors.push([0, 255, 0, 255]);
		colors.push([0, 0, 255, 255]);
	}

	if (cmy) {
		colors.push([255, 255, 0, 255]);
		colors.push([255, 0, 255, 255]);
		colors.push([0, 255, 255, 255]);
	}

	if (black) {
		colors.push([0, 0, 0, 255]);
	}

	if (white) {
		colors.push([255, 255, 255, 255]);
	}

	for (let _ = 0; _ < times; _++) {
		let blockX = Math.floor(rnd() * w);
		let blockY = Math.floor(rnd() * h);

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
				set(dstX, dstY, color);
			}
		}
	}
});

export default {
	name: 'colorBlocks',
	displayName: 'Color blocks',
	paramDefs,
	fn
};
