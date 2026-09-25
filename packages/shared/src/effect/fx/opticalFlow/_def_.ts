import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'opticalFlow',
	displayName: 'Optical flow',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		strength: { dataType: 'scalar', ui: { label: 'Strength', control: 'range', min: 0, max: 10, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		confidence: { dataType: 'scalar', ui: { label: 'Confidence threshold', control: 'range', min: 0, max: 0.01, step: 0.0001 }, defaultValue: { inputSource: 'literal', value: 0.0001 } },
		smoothing: { dataType: 'scalar', ui: { label: 'Smoothing', control: 'range', min: 0, max: 3, step: 0.1 }, defaultValue: { inputSource: 'literal', value: 1 } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'vector' },
	},
});
