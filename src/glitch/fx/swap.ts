import { fx } from '../core';

const paramDef = {
};

const fn = fx(paramDef, (w, h, get, set) => {
	for (let x = 0; x < w; x++) {
		for (let y = 0; y < h; y++) {
			const [r, g, b] = get(x, y);
			set(x, y, [b, g, r]);
		}
	}
});

export default {
	name: 'swap',
	displayName: 'Swap',
	paramDef,
	fn
};