import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'blur',
	displayName: 'Blur',
	tags: [],
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		amount: { type: 'range', label: 'Amount', min: 0, max: 1, step: 0.01, canNode: true, default: () => ({ type: 'literal', value: 0.25 }) },
		samples: { type: 'range', label: 'Samples', min: 4, max: 256, step: 1, default: () => ({ type: 'literal', value: 16 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
