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
		default: 'left'
	},
};

export default fx('tear', paramDef, (width, height, get, set, params) => {
	if (params.direction === 'right') {
		// 端をミラーリング
		for (let x = 0; x < params.amount; x++) {
			const maxY = Math.min(height, params.pos + params.thickness);
			for (let y = params.pos; y < maxY; y++) {
				set(x, y, get(params.amount - x, y));
			}
		}

		// シフト
		for (let x = params.amount; x < width; x++) {
			const maxY = Math.min(height, params.pos + params.thickness);
			for (let y = params.pos; y < maxY; y++) {
				set(x, y, get(x - params.amount, y));
			}
		}
	} else if (params.direction === 'left') {
		// 端をミラーリング
		for (let x = (width - params.amount); x < width; x++) {
			const maxY = Math.min(height, params.pos + params.thickness);
			for (let y = params.pos; y < maxY; y++) {
				set(x, y, get(width - (x - (width - params.amount)) - 1, y));
			}
		}

		// シフト
		for (let x = 0; x < (width - params.amount); x++) {
			const maxY = Math.min(height, params.pos + params.thickness);
			for (let y = params.pos; y < maxY; y++) {
				set(x, y, get(x + params.amount, y));
			}
		}
	}
});
