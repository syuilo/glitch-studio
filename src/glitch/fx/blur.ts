import seedrandom from 'seedrandom';
import { fx } from '../core';
import { blend } from '../color';

const paramDef = {
	times: {
		type: 'range',
		default: 256
	},
	velocity: {
		type: 'range',
		default: 32
	},
	size: {
		type: 'range',
		default: 1
	},
	fade: {
		type: 'bool',
		default: true
	},
	direction: {
		type: 'enum',
		default: 'left'
	},
	range: {
		type: 'range',
		default: 64
	},
	pos: {
		type: 'range',
		default: 0
	},
	seed: {
		type: 'number',
		default: 0,
	}
};

const fn = fx(paramDef, (w, h, get, set, params) => {
	const { times, velocity, size, fade, seed } = params;

	const rnd = seedrandom(seed.toString());

	for (let _ = 0; _ < times; _++) {
		const pxX = Math.floor(rnd() * w);
		const pxY = Math.floor(rnd() * h);

		for (let i = 0; i < velocity; i++) {
			const dstX = pxX + i;
			const dstY = pxY;

			if (dstX >= w) continue;

			for (let j = 0; j < size; j++) {
				if (dstY + j >= h) continue;

				if (fade) {
					set(dstX, dstY + j, blend(
						get(dstX, dstY + j), get(pxX, pxY + j),
						1 - (i / velocity)
					));
				} else {
					set(dstX, dstY + j, get(dstX, dstY));
				}
			}
		}
	}
});

export default {
	name: 'blur',
	paramDef,
	fn
};
