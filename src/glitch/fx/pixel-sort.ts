import seedrandom from 'seedrandom';
import { fx, basicParamDefs, Color } from '../core';
import { getLuminance, getBrightness } from '../color';

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
	trigger: {
		label: 'Trigger',
		type: 'enum' as const,
		options: [{
			label: 'Luminance',
			value: 'luminance',
		}, {
			label: 'Brightness',
			value: 'brightness',
		}, {
			label: 'Random',
			value: 'random',
		}],
		default: { type: 'literal' as const, value: 'luminance' }
	},
	seed: {
		label: 'Seed',
		type: 'seed' as const,
		default: { type: 'literal' as const, value: 0 },
		visibility: (state: any) => {
			return state.trigger.type === 'expression' || state.trigger.value === 'random';
		}
	},

	...basicParamDefs,
};


const fn = fx((w, h, get, set, params) => {
	const { threshold, direction, trigger, sort: sortMode, seed } = params;

	const rnd = seedrandom(seed.toString());

	function getRandom(color: Color) {
		return rnd() * 255;
	}

	const getValue =
		trigger === 'luminance' ? getLuminance :
		trigger === 'brightness' ? getBrightness :
		getRandom;

	const sort = sortMode === 'ab' ?
		(a: Color, b: Color) => getLuminance(a) - getLuminance(b) :
		(a: Color, b: Color) => getLuminance(b) - getLuminance(a);

	if (direction === 'h') {
		for (let y = 0; y < h; y++) {
			let pixels = [] as Color[];
			for (let x = 0; x < w; x++) {
				const [r, g, b, a] = get(x, y);
				const v = getValue([r, g, b, a]);
				if (v <= threshold && x < w - 1) {
					pixels.push([r, g, b, a]);
				} else if (pixels.length > 0) { // Start sort
					pixels.push([r, g, b, a]);
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
				if (v <= threshold && y < h - 1) {
					pixels.push([r, g, b, a]);
				} else if (pixels.length > 0) { // Start sort
					pixels.push([r, g, b, a]);
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
