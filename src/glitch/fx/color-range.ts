import { fx, basicParamDefs } from '../core';

const paramDefs = {
	rLevel: {
		label: 'R',
		type: 'range2' as const,
		min: 0,
		max: 255,
		default: { type: 'literal' as const, value: [0, 255] }
	},
	gLevel: {
		label: 'G',
		type: 'range2' as const,
		min: 0,
		max: 255,
		default: { type: 'literal' as const, value: [0, 255] }
	},
	bLevel: {
		label: 'B',
		type: 'range2' as const,
		min: 0,
		max: 255,
		default: { type: 'literal' as const, value: [0, 255] }
	},

	...basicParamDefs,
};

const fn = fx((w, h, get, set, params) => {
	const { rLevel, gLevel, bLevel } = params;

	for (let x = 0; x < w; x++) {
		for (let y = 0; y < h; y++) {
			let [r, g, b, a] = get(x, y);

			r = Math.max(r, rLevel[0]);
			r = Math.min(r, rLevel[1]);

			g = Math.max(g, gLevel[0]);
			g = Math.min(g, gLevel[1]);

			b = Math.max(b, bLevel[0]);
			b = Math.min(b, bLevel[1]);

			set(x, y, [r, g, b, a]);
		}
	}
});

export default {
	name: 'colorRange_2',
	displayName: 'Color Range',
	paramDefs,
	fn
};
