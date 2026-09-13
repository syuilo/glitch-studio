import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'blockShuffle',
	displayName: 'Block shuffle',
	category: 'glitch',
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		amount: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Amount', default: () => ({ type: 'literal', value: 0.5 }) },
		size: { type: 'vector', min: 0, max: 1, step: 0.01, label: 'Size', default: () => ({ type: 'literal', value: [0.9, 0.9] }) },
		seed: { type: 'seed', label: 'Seed', default: () => ({ type: 'literal', value: 0 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
