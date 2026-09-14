import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'drosteRegression',
	displayName: 'Droste Regression',
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		amount: { type: 'range', min: 0, max: 32, step: 0.01, label: 'Amount', default: () => ({ type: 'literal', value: 0.5 }) },
		twist: { type: 'range', min: 0.04, max: 8, step: 0.001, label: 'Twist', default: () => ({ type: 'literal', value: 2 }) },
		wrap: { type: 'wrapMode', label: 'Wrap', default: () => ({ type: 'literal', value: 'repeatMirrored' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
