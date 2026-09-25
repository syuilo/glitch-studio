import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'lcd',
	displayName: 'LCD',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		size: { dataType: 'scalar', ui: { label: 'Size', control: 'range', min: 1, max: 200, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 50 } },
		border: { dataType: 'scalar', ui: { label: 'Border', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.1 } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
