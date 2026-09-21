import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'scalarGradient',
	displayName: 'Scalar Gradient',
	tags: [],
	paramDefs: {
		input: { dataType: 'scalar', ui: { label: 'Input', control: 'number' }, canNode: true, primary: true, defaultValue: { inputSource: 'literal', value: 0 } },
		strength: { dataType: 'scalar', ui: { label: 'Strength', control: 'number', step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		normalize: { dataType: 'bool', ui: { label: 'Normalize', control: 'bool' }, defaultValue: { inputSource: 'literal', value: false } },
	},
	outputs: {
		output: { primary: true, dataType: 'vector' },
	},
});
