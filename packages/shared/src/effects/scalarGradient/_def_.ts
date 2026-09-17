import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'scalarGradient',
	displayName: 'Scalar Gradient',
	tags: [],
	paramDefs: {
		input: { type: 'number', label: 'Input', canNode: true, primary: true, default: () => ({ type: 'literal', value: 0 }) },
		strength: { type: 'number', label: 'Strength', step: 0.01, default: () => ({ type: 'literal', value: 1 }) },
		normalize: { type: 'bool', label: 'Normalize', default: () => ({ type: 'literal', value: false }) },
	},
	outputs: {
		output: { primary: true, dataType: 'vector' },
	},
});
