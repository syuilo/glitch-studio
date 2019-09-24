import { fx, basicParamDefs } from '../core';

const paramDefs = {
	masterBlackLevel: {
		label: 'Master Black',
		type: 'range' as const,
		min: 0,
		max: 255,
		default: { type: 'literal' as const, value: 0 }
	},
	masterWhiteLevel: {
		label: 'Master White',
		type: 'range' as const,
		min: 0,
		max: 255,
		default: { type: 'literal' as const, value: 255 }
	},
	masterOutputBlackLevel: {
		label: 'Master Output Black',
		type: 'range' as const,
		min: 0,
		max: 255,
		default: { type: 'literal' as const, value: 0 }
	},
	masterOutputWhiteLevel: {
		label: 'Master Output White',
		type: 'range' as const,
		min: 0,
		max: 255,
		default: { type: 'literal' as const, value: 255 }
	},
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
	rOutputBlackLevel: {
		label: 'R Output Black',
		type: 'range' as const,
		min: 0,
		max: 255,
		default: { type: 'literal' as const, value: 0 }
	},
	rOutputWhiteLevel: {
		label: 'R Output White',
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
	gOutputBlackLevel: {
		label: 'G Output Black',
		type: 'range' as const,
		min: 0,
		max: 255,
		default: { type: 'literal' as const, value: 0 }
	},
	gOutputWhiteLevel: {
		label: 'G Output White',
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
	bOutputBlackLevel: {
		label: 'B Output Black',
		type: 'range' as const,
		min: 0,
		max: 255,
		default: { type: 'literal' as const, value: 0 }
	},
	bOutputWhiteLevel: {
		label: 'B Output White',
		type: 'range' as const,
		min: 0,
		max: 255,
		default: { type: 'literal' as const, value: 255 }
	},

	...basicParamDefs,
};

const fn = fx((w, h, get, set, params) => {
	const {
		masterBlackLevel, masterWhiteLevel, masterOutputBlackLevel, masterOutputWhiteLevel,
		rBlackLevel, rWhiteLevel, rOutputBlackLevel, rOutputWhiteLevel,
		gBlackLevel, gWhiteLevel, gOutputBlackLevel, gOutputWhiteLevel,
		bBlackLevel, bWhiteLevel, bOutputBlackLevel, bOutputWhiteLevel,
	} = params;

	for (let x = 0; x < w; x++) {
		for (let y = 0; y < h; y++) {
			let [r, g, b, a] = get(x, y);

			//#region Master
			r = Math.floor(Math.min(255, Math.max(0, (r - masterBlackLevel) * 255 / (masterWhiteLevel - masterBlackLevel))));
			r = Math.min(255, r + (masterOutputBlackLevel * (1 - (r / 255))));
			r = Math.max(0, r - ((255 - masterOutputWhiteLevel) * (r / 255)));

			g = Math.floor(Math.min(255, Math.max(0, (g - masterBlackLevel) * 255 / (masterWhiteLevel - masterBlackLevel))));
			g = Math.min(255, g + (masterOutputBlackLevel * (1 - (g / 255))));
			g = Math.max(0, g - ((255 - masterOutputWhiteLevel) * (g / 255)));

			b = Math.floor(Math.min(255, Math.max(0, (b - masterBlackLevel) * 255 / (masterWhiteLevel - masterBlackLevel))));
			b = Math.min(255, b + (masterOutputBlackLevel * (1 - (b / 255))));
			b = Math.max(0, b - ((255 - masterOutputWhiteLevel) * (b / 255)));
			//#endregion

			//#region Per color
			r = Math.floor(Math.min(255, Math.max(0, (r - rBlackLevel) * 255 / (rWhiteLevel - rBlackLevel))));
			r = Math.min(255, r + (rOutputBlackLevel * (1 - (r / 255))));
			r = Math.max(0, r - ((255 - rOutputWhiteLevel) * (r / 255)));

			g = Math.floor(Math.min(255, Math.max(0, (g - gBlackLevel) * 255 / (gWhiteLevel - gBlackLevel))));
			g = Math.min(255, g + (gOutputBlackLevel * (1 - (g / 255))));
			g = Math.max(0, g - ((255 - gOutputWhiteLevel) * (g / 255)));

			b = Math.floor(Math.min(255, Math.max(0, (b - bBlackLevel) * 255 / (bWhiteLevel - bBlackLevel))));
			b = Math.min(255, b + (bOutputBlackLevel * (1 - (b / 255))));
			b = Math.max(0, b - ((255 - bOutputWhiteLevel) * (b / 255)));
			//#endregion

			set(x, y, [r, g, b, a]);
		}
	}
});

export default {
	name: 'levels',
	displayName: 'Levels',
	paramDefs,
	fn
};
