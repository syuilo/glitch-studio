import { fx, basicParamDefs, Color } from '../core';
import { getLuminance, getBrightness } from '../color';

const paramDefs = {
	mode: {
		label: 'Mode',
		type: 'enum' as const,
		options: [{
			label: 'Luminance',
			value: 'luminance',
		}, {
			label: 'Brightness',
			value: 'brightness',
		}],
		default: { type: 'literal' as const, value: 'luminance' }
	},

	...basicParamDefs,
};

const fn = fx((w, h, get, set, params) => {
	const fn = params.mode === 'luminance'
		? getLuminance
		: getBrightness;

	for (let x = 0; x < w; x++) {
		for (let y = 0; y < h; y++) {
			const v = fn(get(x, y));
			set(x, y, [Math.floor(v), Math.floor(v), Math.floor(v), 255]);
		}
	}
});

export default {
	name: 'grayscale',
	displayName: 'Grayscale',
	paramDefs,
	fn
};
