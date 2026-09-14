import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'opticalFlow',
	displayName: 'Optical flow',
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		strength: { type: 'range', label: 'Strength', min: 0, max: 10, step: 0.01, default: () => ({ type: 'literal', value: 1 }) },
		confidence: { type: 'range', label: 'Confidence threshold', min: 0, max: 0.01, step: 0.0001, default: () => ({ type: 'literal', value: 0.0001 }) },
		smoothing: { type: 'range', label: 'Smoothing', min: 0, max: 3, step: 0.1, default: () => ({ type: 'literal', value: 1 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'vector' },
	},
});
