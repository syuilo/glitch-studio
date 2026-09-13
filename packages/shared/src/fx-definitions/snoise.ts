import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'snoise',
	displayName: 'snoise',
	category: 'utility',
	paramDefs: {
		time: { type: 'range', min: 0, max: 100, step: 0.01, label: 'Time', default: () => ({ type: 'expression', expression: 'TIME' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'scalar' },
	},
});
