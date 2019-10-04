import { fx, basicParamDefs } from '../../core';

const paramDefs = {
	rBlackLevel: {
		label: 'R Black',
		type: 'range' as const,
		min: 0,
		max: 255,
		default: { type: 'literal' as const, value: 0 }
	},
	rWhiteLevel: {
		label: 'R White',
		type: 'range' as const,
		min: 0,
		max: 255,
		default: { type: 'literal' as const, value: 255 }
	},
	gBlackLevel: {
		label: 'G Black',
		type: 'range' as const,
		min: 0,
		max: 255,
		default: { type: 'literal' as const, value: 0 }
	},
	gWhiteLevel: {
		label: 'G White',
		type: 'range' as const,
		min: 0,
		max: 255,
		default: { type: 'literal' as const, value: 255 }
	},
	bBlackLevel: {
		label: 'B Black',
		type: 'range' as const,
		min: 0,
		max: 255,
		default: { type: 'literal' as const, value: 0 }
	},
	bWhiteLevel: {
		label: 'B White',
		type: 'range' as const,
		min: 0,
		max: 255,
		default: { type: 'literal' as const, value: 255 }
	},

	...basicParamDefs,
};

const fn = fx((w, h, get, set, params) => {
	const {
		rBlackLevel, rWhiteLevel,
		gBlackLevel, gWhiteLevel,
		bBlackLevel, bWhiteLevel,
	} = params;

	for (let x = 0; x < w; x++) {
		for (let y = 0; y < h; y++) {
			let [r, g, b, a] = get(x, y);

			r = Math.max(r, rBlackLevel);
			r = Math.min(r, rWhiteLevel);

			g = Math.max(g, gBlackLevel);
			g = Math.min(g, gWhiteLevel);

			b = Math.max(b, bBlackLevel);
			b = Math.min(b, bWhiteLevel);

			set(x, y, [r, g, b, a]);
		}
	}
});

export default {
	name: 'colorRange',
	displayName: 'Color Range (Legacy)',
	paramDefs,
	fn
};
