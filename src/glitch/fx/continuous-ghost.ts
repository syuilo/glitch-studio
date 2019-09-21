import { fx, basicParamDefs, Color } from '../core';
import { getLuminance } from '../color';

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

	...basicParamDefs,
};

const fn = fx((w, h, get, set, params) => {
	const { threshold, direction } = params;

	if (direction === 'h') {
		for (let y = 0; y < h; y++) {
			let color = null as Color | null;
			for (let x = 0; x < w; x++) {
				if (color) {
					set(x, y, color);
				} else {
					const [r, g, b, a] = get(x, y);
					const luminance = getLuminance([r, g, b, a]);
					if (luminance >= threshold) {
						color = [r, g, b, a];
					}
				}
			}
		}
	} else {
		for (let x = 0; x < w; x++) {
			let color = null as Color | null;
			for (let y = 0; y < h; y++) {
				if (color) {
					set(x, y, color);
				} else {
					const [r, g, b, a] = get(x, y);
					const luminance = getLuminance([r, g, b, a]);
					if (luminance >= threshold) {
						color = [r, g, b, a];
					}
				}
			}
		}
	}
});

export default {
	name: 'continuousGhost',
	displayName: 'Continuous Ghost',
	paramDefs,
	fn
};
