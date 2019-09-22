import { fx, basicParamDefs } from '../core';

const paramDefs = {
	...basicParamDefs,
};

const fn = fx((w, h, get, set) => {
	for (let x = 0; x < w; x++) {
		for (let y = 0; y < h; y++) {
			set(x, y,get(x, y));
		}
	}
});

export default {
	name: 'copy',
	displayName: 'Copy',
	paramDefs,
	fn
};
