import { fx, basicParamDefs } from '../core';
import seedrandom from 'seedrandom';

const paramDefs = {
	size: {
		label: 'Size',
		type: 'number' as const,
		default: { type: 'literal' as const, value: 1 }
	},
	colored: {
		label: 'Colored',
		type: 'bool' as const,
		default: { type: 'literal' as const, value: false }
	},
	seed: {
		label: 'Seed',
		type: 'seed' as const,
		default: { type: 'literal' as const, value: 0 },
	},

	...basicParamDefs,
};

const fn = fx((w, h, get, set, params) => {
	const { colored, seed, size } = params;

	const rnd = seedrandom(seed.toString());

	if (colored) {
		for (let x = 0; x < w; x += size) {
			for (let y = 0; y < h; y += size) {
				const r = Math.floor(rnd() * 255);
				const g = Math.floor(rnd() * 255);
				const b = Math.floor(rnd() * 255);
				for (let i = 0; i < size; i++) {
					if (x + i >= w) continue;
					for (let j = 0; j < size; j++) {
						if (y + j >= h) continue;
						set(x + i, y + j, [r, g, b, 255]);
					}
				}
			}
		}
	} else {
		for (let x = 0; x < w; x += size) {
			for (let y = 0; y < h; y += size) {
				const v = Math.floor(rnd() * 255);
				for (let i = 0; i < size; i++) {
					if (x + i >= w) continue;
					for (let j = 0; j < size; j++) {
						if (y + j >= h) continue;
						set(x + i, y + j, [v, v, v, 255]);
					}
				}
			}
		}
	}
});

export default {
	name: 'noise',
	displayName: 'Noise',
	paramDefs,
	fn
};
