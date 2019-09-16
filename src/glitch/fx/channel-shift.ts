import { fx } from '../core';

const paramDef = {
	amount: {
		type: 'range',
		default: 8
	},
	leftR: {
		type: 'bool',
		default: true
	},
	leftG: {
		type: 'bool',
		default: false
	},
	leftB: {
		type: 'bool',
		default: false
	},
	rightR: {
		type: 'bool',
		default: false
	},
	rightG: {
		type: 'bool',
		default: false
	},
	rightB: {
		type: 'bool',
		default: true
	},
};

const fn = fx(paramDef, (w, h, get, set, params) => {
	const { amount, leftR, leftG, leftB, rightR, rightG, rightB } = params;

	for (let x = 0; x < w; x++) {
		for (let y = 0; y < h; y++) {
			const [lr, lg, lb] = get(Math.min(w, x + amount), y);
			const [rr, rg, rb] = get(Math.max(0, x - amount), y);
			const [r, g, b] = get(x, y);
			let _r = r;
			if (leftR) _r = Math.max(_r, lr);
			if (rightR) _r = Math.max(_r, rr);
			let _g = g;
			if (leftG) _g = Math.max(_g, lg);
			if (rightG) _g = Math.max(_g, rg);
			let _b = b;
			if (leftB) _b = Math.max(_b, lb);
			if (rightB) _b = Math.max(_b, rb);
			set(x, y, [_r, _g, _b]);
		}
	}
});

export default {
	name: 'channelShift',
	displayName: 'Channel shift',
	paramDef,
	fn
};
