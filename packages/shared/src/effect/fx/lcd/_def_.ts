import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'lcd',
	displayName: 'LCD',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		size: { dataType: { kind: 'scalar' }, ui: { label: 'Size', control: { controlType: 'range', min: 0.001, max: 1, logarithmic: true } }, defaultValue: { inputSource: 'literal', value: 0.01 } },
		border: { dataType: { kind: 'scalar' }, ui: { label: 'Border', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.1 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
