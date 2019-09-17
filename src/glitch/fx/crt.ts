import { fx, basicParamDefs } from '../core';
import { blend } from '../color';

const paramDefs = {
	frequency: {
		label: 'Frequency',
		type: 'number' as const,
		default: { type: 'literal' as const, value: 8 }
	},
	
	...basicParamDefs,
};

const fn = fx((w, h, get, set, params) => {
	const { frequency } = params;

	for (let x = 0; x < w; x++) {
		for (let y = 0; y < h; y++) {
			const strength = Math.sin(y / frequency);
			const color = blend(get(x, y), [0, 0, 0, 255], strength);
			set(x, y, color);
		}
	}
});

export default {
	name: 'crt',
	displayName: 'CRT',
	paramDefs,
	fn
};
