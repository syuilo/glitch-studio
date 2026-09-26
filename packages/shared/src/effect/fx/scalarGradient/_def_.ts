import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'scalarGradient',
	displayName: 'Scalar Gradient',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'scalar' }, ui: { label: 'Input', control: { controlType: 'number' } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		strength: { dataType: { kind: 'scalar' }, ui: { label: 'Strength', control: { controlType: 'number', step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		normalize: { dataType: { kind: 'bool' }, ui: { label: 'Normalize', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'vector' } },
	},
});
