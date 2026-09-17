import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'bloom',
	displayName: 'Bloom',
	tags: [],
	paramDefs: {
		input: { type: 'color', label: 'Input', canNode: true, primary: true, default: () => ({ type: 'node', nodeId: null, outputPort: null }) },
		strength: { type: 'range', label: 'Strength', min: 0, max: 5, step: 0.01, default: () => ({ type: 'literal', value: 1 }) },
		threshold: { type: 'range', label: 'Threshold', min: 0, max: 1, step: 0.01, default: () => ({ type: 'literal', value: 0.7 }) },
		softKnee: { type: 'range', label: 'Soft knee', min: 0, max: 1, step: 0.01, default: () => ({ type: 'literal', value: 0.5 }) },
		radius: { type: 'vector', label: 'Radius', min: 0, max: 1, step: 0.01, default: () => ({ type: 'literal', value: [0.7, 0.7] }) },
		quality: { type: 'range', label: 'Quality', min: 0.1, max: 1, step: 0.05, default: () => ({ type: 'literal', value: 0.5 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
