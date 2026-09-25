import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'remap',
	displayName: 'Remap',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: 'scalar', ui: { label: 'Input', control: 'number' }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		inMin: { dataType: 'scalar', ui: { label: 'In Min', control: 'number', step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		inMax: { dataType: 'scalar', ui: { label: 'In Max', control: 'number', step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
		outMin: { dataType: 'scalar', ui: { label: 'Out Min', control: 'number', step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		outMax: { dataType: 'scalar', ui: { label: 'Out Max', control: 'number', step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'scalar' },
	},
});
