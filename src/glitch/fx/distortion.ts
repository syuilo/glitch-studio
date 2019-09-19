import { fx, basicParamDefs } from '../core';

const paramDefs = {
	frequency: {
		label: 'Frequency',
		type: 'number' as const,
		default: { type: 'literal' as const, value: 8 }
	},
	amount: {
		label: 'Amount',
		type: 'number' as const,
		default: { type: 'literal' as const, value: 16 }
	},
	
	...basicParamDefs,
};

const fn = fx((w, h, get, set, params) => {
	const { frequency, amount } = params;

	for (let y = 0; y < h; y++) {
		const velocity = Math.floor(Math.sin(y / frequency) * amount);

		if (velocity < 0) {
			// 端をミラーリング
			for (let x = (w - Math.abs(velocity)); x < w; x++) {
				set(x, y, get(w - (x - (w - Math.abs(velocity))) - 1, y));
			}

			for (let x = 0; x < w; x++) {
				if (x + velocity < 0) continue;
				set(x, y, get(x + velocity, y));
			}
		} else if (velocity > 0) {
			// 端をミラーリング
			for (let x = 0; x < velocity; x++) {
				set(x, y, get(velocity - x, y));
			}

			for (let x = 0; x < w; x++) {
				if (x + velocity >= w) continue;
				set(x, y, get(x + velocity, y));
			}
		}
	}
});

export default {
	name: 'distortion',
	displayName: 'Distortion',
	paramDefs,
	fn
};
