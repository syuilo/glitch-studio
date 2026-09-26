import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'chromaticAberration',
	displayName: 'Chromatic Aberration',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		amount: { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.1 } },
		fitMode: { dataType: { kind: 'fitMode' }, ui: { label: 'Fit Mode', control: {} }, defaultValue: { inputSource: 'literal', value: 'cover' } },
		rStrength: { dataType: { kind: 'scalar' }, ui: { label: 'R strength', control: { controlType: 'range', min: -10, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		gStrength: { dataType: { kind: 'scalar' }, ui: { label: 'G strength', control: { controlType: 'range', min: -10, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1.5 } },
		bStrength: { dataType: { kind: 'scalar' }, ui: { label: 'B strength', control: { controlType: 'range', min: -10, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 2 } },
		samples: { dataType: { kind: 'scalar' }, ui: { label: 'Samples', control: { controlType: 'number', min: 1, max: 100 } }, defaultValue: { inputSource: 'literal', value: 32 } },
		start: { dataType: { kind: 'scalar' }, ui: { label: 'Start', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		vector: { dataType: { kind: 'vector' }, ui: { label: 'Vector', control: { controlType: 'vector', step: 0.01, min: -5, max: 5 } }, defaultValue: { inputSource: 'literal', value: [0, 0] } },
		normalize: { dataType: { kind: 'bool' }, ui: { label: 'Normalize', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
