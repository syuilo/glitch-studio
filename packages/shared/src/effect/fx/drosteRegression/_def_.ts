import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'drosteRegression',
	displayName: 'Droste Regression',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		amount: { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 32, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		twist: { dataType: { kind: 'scalar' }, ui: { label: 'Twist', control: { controlType: 'range', min: 0.04, max: 8, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 2 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
