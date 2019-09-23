import { fx, basicParamDefs } from '../core';

const paramDefs = {
	size: {
		label: 'Size',
		type: 'number' as const,
		min: 3,
		default: { type: 'literal' as const, value: 3 }
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

			for (let i = 0; i < size; i++) {
				for (let j = 0; j < size; j++) {
					const [r, g, b] = get(x + i, y + j);
					rTotal += r;
					gTotal += g;
					bTotal += b;
				}
			}

			const rAvg = rTotal / (size * size);
			const gAvg = gTotal / (size * size);
			const bAvg = bTotal / (size * size);
			//#endergion

			// R
			for (let i = 0; i < (size / 3); i++) {
				for (let j = 0; j < size; j++) {
					set(x + i, y + j, [rAvg, 0, 0, 255]);
				}
			}

			// G
			for (let i = 0; i < (size / 3); i++) {
				for (let j = 0; j < size; j++) {
					set(x + (size / 3) + i, y + j, [0, gAvg, 0, 255]);
				}
			}

			// B
			for (let i = 0; i < (size / 3); i++) {
				for (let j = 0; j < size; j++) {
					set(x + (size / 3) + (size / 3) + i, y + j, [0, 0, bAvg, 255]);
				}
			}
		}
	}
});

export default {
	name: 'lcd',
	displayName: 'LCD',
	paramDefs,
	fn
};
