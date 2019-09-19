import { fx, basicParamDefs } from '../core';
import seedrandom from 'seedrandom';

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
	randomFrequency: {
		label: 'Random Frequency',
		type: 'bool' as const,
		default: { type: 'literal' as const, value: false }
	},
	randomAmount: {
		label: 'Random Amount',
		type: 'bool' as const,
		default: { type: 'literal' as const, value: false }
	},
	seed: {
		label: 'Seed',
		type: 'seed' as const,
		default: { type: 'literal' as const, value: 0 },
	},
	
	...basicParamDefs,
};

const fn = fx((w, h, get, set, params) => {
	const { frequency, amount, randomFrequency, randomAmount, seed } = params;

	const rnd = seedrandom(seed.toString());

	for (let y = 0; y < h; y++) {
		const f = (randomFrequency ? rnd() : 1) * frequency;
		const a = (randomAmount ? rnd() : 1) * amount;
		const velocity = Math.floor(Math.sin(y / f) * a);

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
