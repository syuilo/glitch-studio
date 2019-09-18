import { fx, basicParamDefs } from '../core';

const paramDefs = {
	color: {
		label: 'Color',
		type: 'color' as const,
		default: { type: 'literal' as const, value: [0, 255, 0] }
	},

	...basicParamDefs,
};

const fn = fx((w, h, get, set, params) => {
	const { color } = params;

	for (let x = 0; x < w; x++) {
		for (let y = 0; y < h; y++) {
			set(x, y, [color[0], color[1], color[2], 255]);
		}
	}
});

export default {
	name: 'fill',
	displayName: 'Fill',
	paramDefs,
	fn
};
