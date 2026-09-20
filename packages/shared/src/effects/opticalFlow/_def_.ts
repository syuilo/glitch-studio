import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'opticalFlow',
	displayName: 'Optical flow',
	tags: [],
	paramDefs: {
		input: { type: 'color', label: 'Input', canNode: true, primary: true, default: () => ({ type: 'node', nodeId: null, outputPort: null }) },
		strength: { type: 'range', label: 'Strength', min: 0, max: 10, step: 0.01, default: () => ({ inputSource: 'literal', value: 1 }) },
		confidence: { type: 'range', label: 'Confidence threshold', min: 0, max: 0.01, step: 0.0001, default: () => ({ inputSource: 'literal', value: 0.0001 }) },
		smoothing: { type: 'range', label: 'Smoothing', min: 0, max: 3, step: 0.1, default: () => ({ inputSource: 'literal', value: 1 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'vector' },
	},
});
