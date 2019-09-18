import { fx, basicParamDefs } from '../core';
import seedrandom from 'seedrandom';

const paramDefs = {
	times: {
		label: 'Times',
		type: 'number' as const,
		default: { type: 'literal' as const, value: 128 }
	},
	size: {
		label: 'Size',
		type: 'number' as const,
		default: { type: 'literal' as const, value: 64 }
	},
	seed: {
		label: 'Seed',
		type: 'seed' as const,
		default: { type: 'literal' as const, value: 0 },
	},
	direction: {
		label: 'Direction',
		type: 'enum' as const,
		options: [{
			label: 'V',
			value: 'v',
		}, {
			label: 'H',
			value: 'h',
		}, {
			label: 'Both',
			value: 'both',
		}],
		default: { type: 'literal' as const, value: 'both' }
	},

	...basicParamDefs,
};

const fn = fx((w, h, get, set, params) => {
	const { times, size, seed, direction } = params;

	const rnd = seedrandom(seed.toString());

	for (let _ = 0; _ < times; _++) {
		const blockX = Math.round(Math.floor(rnd() * w) / size) * size;
		const blockY = Math.round(Math.floor(rnd() * h) / size) * size;

		const dir =
			direction === 'h' ? 0 :
			direction === 'v' ? 1 :
			Math.floor(rnd() * 2);

		if (dir === 0) { // H
			for (let i = 0; i < size; i++) {
				const dstX = blockX + i;
				if (dstX >= w) continue;
				for (let j = 0; j < size; j++) {
					const dstY = blockY + j;
					if (dstY >= h) continue;
					set(dstX, dstY, get(blockX, blockY + j));
				}
			}
		} else { // V
			for (let i = 0; i < size; i++) {
				const dstY = blockY + i;
				if (dstY >= h) continue;
				for (let j = 0; j < size; j++) {
					const dstX = blockX + j;
					if (dstX >= w) continue;
					set(dstX, dstY, get(blockX + j, blockY));
				}
			}
		}
	}
});

export default {
	name: 'blockStretch',
	displayName: 'Block Stretch',
	paramDefs,
	fn
};
