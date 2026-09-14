import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'bloom',
	displayName: 'Bloom',
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		strength: { type: 'range', label: 'Strength', min: 0, max: 5, step: 0.01, default: () => ({ type: 'literal', value: 1 }) },
		threshold: { type: 'range', label: 'Threshold', min: 0, max: 1, step: 0.01, default: () => ({ type: 'literal', value: 0.7 }) },
		softKnee: { type: 'range', label: 'Soft knee', min: 0, max: 1, step: 0.01, default: () => ({ type: 'literal', value: 0.5 }) },
		radius: { type: 'range', label: 'Radius', min: 0, max: 1, step: 0.01, default: () => ({ type: 'literal', value: 0.7 }) },
		quality: { type: 'range', label: 'Quality', min: 0.1, max: 1, step: 0.05, default: () => ({ type: 'literal', value: 0.5 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
