import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'colorMix',
	displayName: 'Mix (Color)',
	tags: [],
	primaryInputParameter: 'inputA',
	paramDefs: {
		inputA: { dataType: 'color', ui: { label: 'A', control: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		inputB: { dataType: 'color', ui: { label: 'B', control: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		amount: { dataType: 'scalar', ui: { label: 'Amount', control: 'range', min: 0, max: 1, step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: 0.5 } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
