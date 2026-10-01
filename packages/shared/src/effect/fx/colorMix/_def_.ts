import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'colorMix',
	displayName: 'Mix (Color)',
	tags: [],
	paramDefs: {
		inputA: { dataType: { kind: 'color' }, ui: { label: 'A', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		inputB: { dataType: { kind: 'color' }, ui: { label: 'B', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		amount: { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0.5 } },
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameter: 'inputA',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
