import seedrandom from 'seedrandom';
import { fx } from '../core';

const paramDef = {
	times: {
		type: 'range',
		default: 32,
	},
	seed: {
		type: 'number',
		default: 0,
	}
};

const fn = fx(paramDef, (w, h, get, set, params) => {
	const rnd = seedrandom(params.seed.toString());

	for (let i = 0; i < params.times; i++) {
		const thickness = Math.floor(rnd() * 64);
		const pos = Math.floor(rnd() * h);
		const amount = Math.floor(rnd() * 64);
		const direction = Math.floor(rnd() * 2) === 0 ? 'left' : 'right';
	
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
	}
});

export default {
	name: 'tearBulk',
	paramDef,
	fn
};
