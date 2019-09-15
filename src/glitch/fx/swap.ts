import { fx } from '../core';

const paramDef = {
};

export default fx('swap', paramDef, (w, h, get, set) => {
	for (let x = 0; x < w; x++) {
		for (let y = 0; y < h; y++) {
			const [r, g, b] = get(x, y);
			set(x, y, [b, g, r]);
		}
	}
});
