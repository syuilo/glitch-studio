import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'opticalFlow',
	displayName: 'Optical flow',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { control: 'color' }, label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		strength: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 10, step: 0.01 }, label: 'Strength', default: () => ({ inputSource: 'literal', value: 1 }) },
		confidence: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 0.01, step: 0.0001 }, label: 'Confidence threshold', default: () => ({ inputSource: 'literal', value: 0.0001 }) },
		smoothing: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 3, step: 0.1 }, label: 'Smoothing', default: () => ({ inputSource: 'literal', value: 1 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'vector' },
	},
});
