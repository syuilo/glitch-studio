import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'bloom',
	displayName: 'Bloom',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		strength: { dataType: { kind: 'scalar' }, ui: { label: 'Strength', control: { controlType: 'range', min: 0, max: 5, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		threshold: { dataType: { kind: 'scalar' }, ui: { label: 'Threshold', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.7 } },
		softKnee: { dataType: { kind: 'scalar' }, ui: { label: 'Soft knee', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		radius: { dataType: { kind: 'vector' }, ui: { label: 'Radius', control: { controlType: 'vector', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: [0.7, 0.7] } },
		quality: { dataType: { kind: 'scalar' }, ui: { label: 'Quality', control: { controlType: 'range', min: 0.1, max: 1, step: 0.05 } }, defaultValue: { inputSource: 'literal', value: 0.5 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
