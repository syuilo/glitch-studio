import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'lcd',
	displayName: 'LCD',
	tags: [],
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		size: { type: 'range', min: 1, max: 200, step: 0.01, label: 'Size', default: () => ({ type: 'literal', value: 50 }) },
		border: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Border', default: () => ({ type: 'literal', value: 0.1 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
