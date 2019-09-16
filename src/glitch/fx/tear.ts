import { fx } from '../core';

const paramDef = {
	thickness: {
		type: 'range',
		default: 64
	},
	pos: {
		type: 'range',
		default: 0
	},
	amount: {
		type: 'range',
		default: 32
	},
	direction: {
		type: 'enum',
		options: ['left', 'right'],
		default: 'left'
	},
};

const fn = fx(paramDef, (w, h, get, set, params) => {
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
	paramDef,
	fn
};
