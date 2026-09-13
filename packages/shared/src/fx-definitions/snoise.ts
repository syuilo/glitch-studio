import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'snoise',
	displayName: 'snoise',
	category: 'utility',
	paramDefs: {
		scale: { type: 'vector', label: 'Scale', min: 0, max: 16, step: 0.01, default: () => ({ type: 'literal', value: [1, 1] }) },
		outputMin: { type: 'number', label: 'Output Min', step: 0.01, default: () => ({ type: 'literal', value: -1 }) },
		outputMax: { type: 'number', label: 'Output Max', step: 0.01, default: () => ({ type: 'literal', value: 1 }) },
		time: { type: 'range', min: 0, max: 100, step: 0.01, label: 'Time', default: () => ({ type: 'expression', expression: 'TIME' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'scalar' },
	},
});
