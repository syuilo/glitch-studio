import { fx } from '../core';

const paramDefs = {
	thickness: {
		label: 'Thickness',
		type: 'range' as const,
		default: { type: 'literal' as const, value: 64 }
	},
	pos: {
		label: 'Position',
		type: 'range' as const,
		default: { type: 'literal' as const, value: 0 }
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
};

const fn = fx(paramDefs, (w, h, get, set, params) => {
	const { thickness, pos, amount, direction } = params;

	if (direction === 'right') {
		// 端をミラーリング
		for (let x = 0; x < amount; x++) {
			const maxY = Math.min(h, pos + thickness);
			for (let y = pos; y < maxY; y++) {
				set(x, y, get(amount - x, y));
			}
		}

		// シフト
		for (let x = amount; x < w; x++) {
			const maxY = Math.min(h, pos + thickness);
			for (let y = pos; y < maxY; y++) {
				set(x, y, get(x - amount, y));
			}
		}
	} else if (direction === 'left') {
		// 端をミラーリング
		for (let x = (w - amount); x < w; x++) {
			const maxY = Math.min(h, pos + thickness);
			for (let y = pos; y < maxY; y++) {
				set(x, y, get(w - (x - (w - amount)) - 1, y));
			}
		}

		// シフト
		for (let x = 0; x < (w - amount); x++) {
			const maxY = Math.min(h, pos + thickness);
			for (let y = pos; y < maxY; y++) {
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
