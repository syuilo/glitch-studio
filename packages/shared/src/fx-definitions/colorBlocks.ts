import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'colorBlocks',
	displayName: 'Color blocks',
	category: 'draw',
	paramDefs: {
		amount: { type: 'range', min: 0, max: 100, step: 1, label: 'Amount', default: () => ({ type: 'literal', value: 50 }) },
		alphaRandomness: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Alpha randomness', default: () => ({ type: 'literal', value: 1 }) },
		size: { type: 'vector', min: 0, max: 1, step: 0.01, label: 'Size', default: () => ({ type: 'literal', value: [0.9, 0.9] }) },
		seed: { type: 'seed', label: 'Seed', default: () => ({ type: 'literal', value: 0 }) },
		rgb: { type: 'bool', label: 'RGB', default: () => ({ type: 'literal', value: true }) },
		cmy: { type: 'bool', label: 'CMY', default: () => ({ type: 'literal', value: true }) },
		black: { type: 'bool', label: 'Black', default: () => ({ type: 'literal', value: true }) },
		white: { type: 'bool', label: 'White', default: () => ({ type: 'literal', value: true }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
