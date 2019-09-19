import { fx, basicParamDefs, Color } from '../core';

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
	function getLuminance(color: Color) {
		return (color[0] * 0.299) + (color[1] * 0.587) + (color[2] * 0.114);
	}

	function getBrightness(color: Color) {
		return ((color[0] + color[1] + color[2]) / (255 * 3)) * 255;
	}

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
