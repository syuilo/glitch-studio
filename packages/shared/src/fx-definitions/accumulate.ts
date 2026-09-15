import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'accumulate',
	displayName: 'Accumulate',
	tags: [],
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'any', primary: true, default: () => ({ type: 'literal', value: null }) },
		strength: { type: 'range', label: 'Strength', min: 0, max: 10, step: 0.01, default: () => ({ type: 'literal', value: 1 }) },
		halfLife: { type: 'range', label: 'Half-life (ms, 0 = infinite)', min: 0, max: 10000, step: 1, default: () => ({ type: 'literal', value: 300 }) },
		reset: { type: 'bool', label: 'Reset', default: () => ({ type: 'literal', value: false }) },
	},
	outputs: {
		output: { primary: true, dataType: 'any' },
	},
});
