import { fx, basicParamDefs } from '../core';
import { getLuminance } from '../color';

const paramDefs = {
	threshold: {
		label: 'Threshold',
		type: 'range' as const,
		min: 0,
		max: 256, // 最大で「真っ黒」にもできるように 255 ではなく 256
		default: { type: 'literal' as const, value: 128 }
	},
	colorA: {
		label: 'Color A',
		type: 'color' as const,
		default: { type: 'literal' as const, value: [255, 255, 255] }
	},
	colorB: {
		label: 'Color B',
		type: 'color' as const,
		default: { type: 'literal' as const, value: [0, 0, 0] }
	},

	...basicParamDefs,
};

const fn = fx((w, h, get, set, params) => {
	const { threshold, colorA, colorB } = params;

	for (let x = 0; x < w; x++) {
		for (let y = 0; y < h; y++) {
			const [r, g, b, a] = get(x, y);
			const luminance = getLuminance([r, g, b, a]);
			if (luminance >= threshold) {
				set(x, y, [colorA[0], colorA[1], colorA[2], 255]);
			} else {
				set(x, y, [colorB[0], colorB[1], colorB[2], 255]);
			}
		}
	}
});

export default {
	name: 'threshold',
	displayName: 'Threshold',
	paramDefs,
	fn
};
