import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'remap',
	displayName: 'Remap',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'scalar' }, ui: { label: 'Input', control: { controlType: 'number' } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		inMin: { dataType: { kind: 'scalar' }, ui: { label: 'In Min', control: { controlType: 'number', step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		inMax: { dataType: { kind: 'scalar' }, ui: { label: 'In Max', control: { controlType: 'number', step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
		outMin: { dataType: { kind: 'scalar' }, ui: { label: 'Out Min', control: { controlType: 'number', step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		outMax: { dataType: { kind: 'scalar' }, ui: { label: 'Out Max', control: { controlType: 'number', step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'scalar' } },
	},
});
