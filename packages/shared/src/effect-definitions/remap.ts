import { defineEffect } from '../effect-definition.ts';

export default defineEffect({
	id: 'remap',
	displayName: 'Remap',
	tags: [],
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'scalar', primary: true, default: () => ({ type: 'literal', value: null }) },
		inMin: { type: 'number', label: 'In Min', step: 0.01, canNode: true, default: () => ({ type: 'literal', value: 0 }) },
		inMax: { type: 'number', label: 'In Max', step: 0.01, canNode: true, default: () => ({ type: 'literal', value: 1 }) },
		outMin: { type: 'number', label: 'Out Min', step: 0.01, canNode: true, default: () => ({ type: 'literal', value: 0 }) },
		outMax: { type: 'number', label: 'Out Max', step: 0.01, canNode: true, default: () => ({ type: 'literal', value: 1 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'scalar' },
	},
});
