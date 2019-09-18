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

	...basicParamDefs,
};

const fn = fx((w, h, get, set, params) => {
	const { times, size, seed } = params;

	const rnd = seedrandom(seed.toString());

	for (let _ = 0; _ < times; _++) {
		const blockX = Math.round(Math.floor(rnd() * w) / size) * size;
		const blockY = Math.round(Math.floor(rnd() * h) / size) * size;
		const refOriginX = Math.round(Math.floor(rnd() * w) / size) * size;
		const refOriginY = Math.round(Math.floor(rnd() * h) / size) * size;

		const xOver = Math.max(0, (blockX + size) - w);
		const yOver = Math.max(0, (blockY + size) - h);

		for (let x = 0; x < size - xOver; x++) {
			const dstX = blockX + x;
			const refX = refOriginX + x;
			if (refX >= w) continue;
			for (let y = 0; y < size - yOver; y++) {
				const dstY = blockY + y;
				const refY = refOriginY + y;
				if (refY >= h) continue;
				set(dstX, dstY, get(refX, refY));
			}
		}
	}
});

export default {
	name: 'replace',
	displayName: 'Replace',
	paramDefs,
	fn
};
