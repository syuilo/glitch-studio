import { fx, basicParamDefs } from '../core';

const paramDefs = {
	thickness: {
		label: 'Thickness',
		type: 'range' as const,
		default: { type: 'literal' as const, value: 64 }
	},
	amount: {
		label: 'Amount',
		type: 'range' as const,
		default: { type: 'literal' as const, value: 32 }
	},
	direction: {
		label: 'Direction',
		type: 'enum' as const,
		options: [{
			label: 'Left',
			value: 'left',
		}, {
			label: 'Right',
			value: 'right',
		}],
		default: { type: 'literal' as const, value: 'left' }
	},

	...basicParamDefs,
};

const fn = fx((w, h, get, set, params) => {
	const { thickness, amount, direction } = params;

	if (direction === 'right') {
		// 端をミラーリング
		for (let x = 0; x < amount; x++) {
			const maxY = Math.min(h, thickness);
			for (let y = 0; y < maxY; y++) {
				set(x, y, get(amount - x, y));
			}
		}

		// シフト
		for (let x = amount; x < w; x++) {
			const maxY = Math.min(h, thickness);
			for (let y = 0; y < maxY; y++) {
				set(x, y, get(x - amount, y));
			}
		}
	} else if (direction === 'left') {
		// 端をミラーリング
		for (let x = (w - amount); x < w; x++) {
			const maxY = Math.min(h, thickness);
			for (let y = 0; y < maxY; y++) {
				set(x, y, get(w - (x - (w - amount)) - 1, y));
			}
		}

		// シフト
		for (let x = 0; x < (w - amount); x++) {
			const maxY = Math.min(h, thickness);
			for (let y = 0; y < maxY; y++) {
				set(x, y, get(x + amount, y));
			}
		}
	}
});

export default {
	name: 'tear',
	displayName: 'Tear',
	paramDefs,
	fn
};
