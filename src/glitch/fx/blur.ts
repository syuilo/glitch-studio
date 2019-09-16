import seedrandom from 'seedrandom';
import { fx } from '../core';
import { blend } from '../color';

const paramDefs = {
	times: {
		type: 'range' as const,
		default: { type: 'literal' as const, value: 256 }
	},
	velocity: {
		type: 'range' as const,
		default: { type: 'literal' as const, value: 32 }
	},
	size: {
		type: 'range' as const,
		default: { type: 'literal' as const, value: 1 }
	},
	fade: {
		type: 'bool' as const,
		default: { type: 'literal' as const, value: true }
	},
	direction: {
		type: 'enum' as const,
		options: ['left', 'right'],
		default: { type: 'literal' as const, value: 'left' }
	},
	range: {
		type: 'range' as const,
		default: { type: 'literal' as const, value: 64 }
	},
	pos: {
		type: 'range' as const,
		default: { type: 'literal' as const, value: 0 }
	},
	seed: {
		type: 'number' as const,
		default: { type: 'literal' as const, value: 0 },
	}
};

const fn = fx(paramDefs, (w, h, get, set, params) => {
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
					set(dstX, dstY + j, get(pxX, pxY + j));
				}
			}
		}
	}
});

export default {
	name: 'blur',
	displayName: 'Blur',
	paramDefs,
	fn
};
