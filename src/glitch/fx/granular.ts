import { fx, basicParamDefs } from '../core';
import seedrandom from 'seedrandom';

const paramDefs = {
	times: {
		label: 'Times',
		type: 'number' as const,
		default: { type: 'literal' as const, value: 128 }
	},
	velocity: {
		label: 'Velocity',
		type: 'number' as const,
		default: { type: 'literal' as const, value: 32 }
	},
	size: {
		label: 'Size',
		type: 'wh' as const,
		default: { type: 'literal' as const, value: [32, 8] }
	},
	cut: {
		label: 'Cut',
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
	const { times, velocity, size, seed, cut } = params;

	const rnd = seedrandom(seed.toString());

	for (let _ = 0; _ < times; _++) {
		const srcX = Math.floor(rnd() * w);
		const srcY = Math.floor(rnd() * h);
		const dstX = srcX + Math.floor((rnd() * (velocity * 2)) - velocity);
		const dstY = srcY + Math.floor((rnd() * (velocity * 2)) - velocity);

		if (cut) {
			for (let x = 0; x < size[0]; x++) {
				if (srcX + x >= w || srcX + x < 0) continue;
				for (let y = 0; y < size[1]; y++) {
					if (srcY + y >= h || srcY + y < 0) continue;
					set(srcX + x, srcY + y, [0, 0, 0, 0]);
				}
			}
		}

		for (let x = 0; x < size[0]; x++) {
			const dstX2 = dstX + x;
			const x2 = srcX + x;

			if (dstX2 >= w || dstX2 < 0) continue;
			if (x2 >= w || x < 0) continue;

			for (let y = 0; y < size[1]; y++) {
				const dstY2 = dstY + y;
				const y2 = srcY + y;

				if (dstY2 >= w || dstY2 < 0) continue;
				if (y2 >= w || y < 0) continue;
	
				set(dstX2, dstY2, get(x2, y2));
			}
		}
	}
});

export default {
	name: 'granular',
	displayName: 'Granular',
	paramDefs,
	fn
};
