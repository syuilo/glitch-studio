import { fx, basicParamDefs, Color } from '../core';

const paramDefs = {
	threshold: {
		label: 'Threshold',
		type: 'range' as const,
		min: 0,
		max: 256,
		default: { type: 'literal' as const, value: 128 }
	},
	direction: {
		label: 'Direction',
		type: 'enum' as const,
		options: [{
			label: 'V',
			value: 'v',
		}, {
			label: 'H',
			value: 'h',
		}],
		default: { type: 'literal' as const, value: 'h' }
	},
	sort: {
		label: 'Sort',
		type: 'enum' as const,
		options: [{
			label: 'A > B',
			value: 'ab',
		}, {
			label: 'B > A',
			value: 'ba',
		}],
		default: { type: 'literal' as const, value: 'ab' }
	},
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
	const { threshold, direction, mode, sort: sortMode } = params;

	function getLuminance(color: Color) {
		return (color[0] * 0.299) + (color[1] * 0.587) + (color[2] * 0.114);
	}

	function getBrightness(color: Color) {
		return ((color[0] + color[1] + color[2]) / (255 * 3)) * 255;
	}

	const getValue = mode === 'luminance' ?
		getLuminance :
		getBrightness;

	const sort = sortMode === 'ab' ?
		(a: Color, b: Color) => getLuminance(a) - getLuminance(b) :
		(a: Color, b: Color) => getLuminance(b) - getLuminance(a);

	if (direction === 'h') {
		for (let y = 0; y < h; y++) {
			let pixels = [] as Color[];
			for (let x = 0; x < w; x++) {
				const [r, g, b, a] = get(x, y);
				const v = getValue([r, g, b, a]);
				if (v >= threshold) {
					pixels.push([r, g, b, a]);
				} else if (pixels.length > 0) { // Start sort
					pixels.sort(sort);
					for (let p = 0; p < pixels.length; p++) {
						set(x - p, y, pixels[p]);
					}
					pixels = [];
				}
			}
		}
	} else {
		for (let x = 0; x < w; x++) {
			let pixels = [] as Color[];
			for (let y = 0; y < h; y++) {
				const [r, g, b, a] = get(x, y);
				const v = getValue([r, g, b, a]);
				if (v >= threshold) {
					pixels.push([r, g, b, a]);
				} else if (pixels.length > 0) { // Start sort
					pixels.sort(sort);
					for (let p = 0; p < pixels.length; p++) {
						set(x, y - p, pixels[p]);
					}
					pixels = [];
				}
			}
		}
	}
});

export default {
	name: 'pixelSort',
	displayName: 'Pixel Sort',
	paramDefs,
	fn
};
