import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'multiply',
	displayName: 'multiply',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'scalar' }, ui: { label: 'Input', control: { controlType: 'number' } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		v: { dataType: { kind: 'scalar' }, ui: { label: 'Value', control: { controlType: 'range', min: -10, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 2 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'scalar' } },
	},
});
