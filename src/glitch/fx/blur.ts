import seedrandom from 'seedrandom';
import { fx, basicParamDefs } from '../core';
import { blend } from '../color';

const paramDefs = {
	times: {
		label: 'Times',
		type: 'number' as const,
		default: { type: 'literal' as const, value: 1024 }
	},
	velocity: {
		label: 'Velocity',
		type: 'number' as const,
		default: { type: 'literal' as const, value: 64 }
	},
	size: {
		label: 'Size',
		type: 'number' as const,
		default: { type: 'literal' as const, value: 1 }
	},
	fade: {
		label: 'Fade',
		type: 'bool' as const,
		default: { type: 'literal' as const, value: true }
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
		}, {
			label: 'Top',
			value: 'top',
		}, {
			label: 'Bottom',
			value: 'bottom',
		}, {
			label: 'Left + Right',
			value: 'leftRight',
		}, {
			label: 'Top + Bottom',
			value: 'topBottom',
		}],
		default: { type: 'literal' as const, value: 'right' }
	},
	randomVelocity: {
		label: 'Random Velocity',
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
	const { times, velocity, size, fade, seed, direction, randomVelocity } = params;

	const rnd = seedrandom(seed.toString());

	for (let _ = 0; _ < times; _++) {
		const pxX = Math.floor(rnd() * w);
		const pxY = Math.floor(rnd() * h);
		const _velocity = randomVelocity ? Math.floor(rnd() * velocity) : velocity;

		const drawH = (dir: 'left' | 'right') => {
			for (let i = 0; i < _velocity; i++) {
				const dstX = dir === 'right' ? pxX + i : pxX - i;
				const dstY = pxY;

				if (dstX >= w) continue;
				if (dstX < 0) continue;

				for (let j = 0; j < size; j++) {
					if (dstY + j >= h) continue;

					if (fade) {
						set(dstX, dstY + j, blend(
							get(dstX, dstY + j), get(pxX, pxY + j),
							1 - (i / _velocity)
						));
					} else {
						set(dstX, dstY + j, get(pxX, pxY + j));
					}
				}
			}
		};

		const drawV = (dir: 'top' | 'bottom') => {
			for (let i = 0; i < _velocity; i++) {
				const dstX = pxX;
				const dstY = dir === 'bottom' ? pxY + i : pxY - i;

				if (dstY >= h) continue;
				if (dstY < 0) continue;

				for (let j = 0; j < size; j++) {
					if (dstX + j >= w) continue;

					if (fade) {
						set(dstX + j, dstY, blend(
							get(dstX + j, dstY), get(pxX + j, pxY),
							1 - (i / _velocity)
						));
					} else {
						set(dstX + j, dstY, get(pxX + j, pxY));
					}
				}
			}
		};

		if (direction === 'left' || direction === 'right') {
			drawH(direction);
		} else if (direction === 'leftRight') {
			drawH('left');
			drawH('right');
		} else if (direction === 'top' || direction === 'bottom') {
			drawV(direction);
		} else if (direction === 'topBottom') {
			drawV('top');
			drawV('bottom');
		}
	}
});

export default {
	name: 'blur',
	displayName: 'Blur',
	paramDefs,
	fn
};
