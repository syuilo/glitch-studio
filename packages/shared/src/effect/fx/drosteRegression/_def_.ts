import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'drosteRegression',
	displayName: 'Droste Regression',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		amount: { dataType: 'scalar', ui: { label: 'Amount', control: 'range', min: 0, max: 32, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		twist: { dataType: 'scalar', ui: { label: 'Twist', control: 'range', min: 0.04, max: 8, step: 0.001 }, defaultValue: { inputSource: 'literal', value: 2 } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
