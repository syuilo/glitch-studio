import { fx, basicParamDefs } from '../core';

const paramDefs = {
	amount: {
		label: 'Amount',
		type: 'range' as const,
		default: { type: 'literal' as const, value: 8 }
	},
	leftSignal: {
		label: 'L signal',
		type: 'signal' as const,
		default: { type: 'literal' as const, value: [true, false, false] }
	},
	rightSignal: {
		label: 'R signal',
		type: 'signal' as const,
		default: { type: 'literal' as const, value: [false, false, true] }
	},
	
	...basicParamDefs,
};

const fn = fx((w, h, get, set, params) => {
	const { amount, leftSignal, rightSignal } = params;
	const leftR = leftSignal[0];
	const leftG = leftSignal[1];
	const leftB = leftSignal[2];
	const rightR = rightSignal[0];
	const rightG = rightSignal[1];
	const rightB = rightSignal[2];

	for (let x = 0; x < w; x++) {
		for (let y = 0; y < h; y++) {
			const [lr, lg, lb] = get(Math.min(w, x + amount), y);
			const [rr, rg, rb] = get(Math.max(0, x - amount), y);
			const [r, g, b, a] = get(x, y);
			let _r = r;
			if (leftR) _r = Math.max(_r, lr);
			if (rightR) _r = Math.max(_r, rr);
			let _g = g;
			if (leftG) _g = Math.max(_g, lg);
			if (rightG) _g = Math.max(_g, rg);
			let _b = b;
			if (leftB) _b = Math.max(_b, lb);
			if (rightB) _b = Math.max(_b, rb);
			set(x, y, [_r, _g, _b, a]);
		}
	}
});

export default {
	name: 'channelShift',
	displayName: 'Channel shift',
	paramDefs,
	fn
};
