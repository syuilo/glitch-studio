import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'opticalFlow',
	displayName: 'Optical flow',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		strength: { dataType: { kind: 'scalar' }, ui: { label: 'Strength', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		confidence: { dataType: { kind: 'scalar' }, ui: { label: 'Confidence threshold', control: { controlType: 'range', min: 0, max: 0.01, step: 0.0001 } }, defaultValue: { inputSource: 'literal', value: 0.0001 } },
		smoothing: { dataType: { kind: 'scalar' }, ui: { label: 'Smoothing', control: { controlType: 'range', min: 0, max: 3, step: 0.1 } }, defaultValue: { inputSource: 'literal', value: 1 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'vector' } },
	},
});
