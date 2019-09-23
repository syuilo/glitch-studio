import { fx, basicParamDefs } from '../core';

const paramDefs = {
	size: {
		label: 'Size',
		type: 'number' as const,
		default: { type: 'literal' as const, value: 16 }
	},
	
	...basicParamDefs,
};

const fn = fx((w, h, get, set, params) => {
	const { size } = params;

	for (let x = 0; x < w; x += size) {
		for (let y = 0; y < h; y += size) {
			//#region Calculate Avg
			let rTotal = 0;
			let gTotal = 0;
			let bTotal = 0;

			let total = 0;

			for (let i = 0; i < size; i++) {
				for (let j = 0; j < size; j++) {
					if (x + i >= w) continue;
					if (y + j >= h) continue;
					const [r, g, b] = get(x + i, y + j);
					rTotal += r;
					gTotal += g;
					bTotal += b;
					total++;
				}
			}

			const rAvg = rTotal / total;
			const gAvg = gTotal / total;
			const bAvg = bTotal / total;
			//#endergion

			for (let i = 0; i < size; i++) {
				for (let j = 0; j < size; j++) {
					if (x + i >= w) continue;
					if (y + j >= h) continue;
					set(x + i, y + j, [rAvg, gAvg, bAvg, 255]);
				}
			}
		}
	}
});

export default {
	name: 'pixelate',
	displayName: 'Pixelate',
	paramDefs,
	fn
};
