import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'opticalFlow',
	displayName: 'Optical flow',
	tags: [],
	paramDefs: {
		input: { type: 'color', label: 'Input', canNode: true, primary: true, default: () => ({ type: 'node', nodeId: null, outputPort: null }) },
		strength: { type: 'range', label: 'Strength', min: 0, max: 10, step: 0.01, default: () => ({ type: 'literal', value: 1 }) },
		confidence: { type: 'range', label: 'Confidence threshold', min: 0, max: 0.01, step: 0.0001, default: () => ({ type: 'literal', value: 0.0001 }) },
		smoothing: { type: 'range', label: 'Smoothing', min: 0, max: 3, step: 0.1, default: () => ({ type: 'literal', value: 1 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'vector' },
	},
});
