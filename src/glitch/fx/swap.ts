import { fx, basicParamDefs } from '../core';

const paramDefs = {
	...basicParamDefs,
};

const fn = fx((w, h, get, set) => {
	for (let x = 0; x < w; x++) {
		for (let y = 0; y < h; y++) {
			const [r, g, b, a] = get(x, y);
			set(x, y, [b, g, r, a]);
		}
	}
});

export default {
	name: 'swap',
	displayName: 'Swap',
	paramDefs,
	fn
};
