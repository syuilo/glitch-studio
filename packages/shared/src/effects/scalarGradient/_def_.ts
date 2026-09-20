import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'scalarGradient',
	displayName: 'Scalar Gradient',
	tags: [],
	paramDefs: {
		input: { dataType: 'number', ui: { control: 'number' }, label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'literal', value: 0 }) },
		strength: { dataType: 'number', ui: { control: 'number', step: 0.01 }, label: 'Strength', default: () => ({ inputSource: 'literal', value: 1 }) },
		normalize: { dataType: 'bool', ui: { control: 'bool' }, label: 'Normalize', default: () => ({ inputSource: 'literal', value: false }) },
	},
	outputs: {
		output: { primary: true, dataType: 'vector' },
	},
});
