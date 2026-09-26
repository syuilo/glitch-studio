import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'colorBlend',
	displayName: 'Blend (Color)',
	tags: [],
	primaryInputParameter: 'inputA',
	paramDefs: {
		inputA: { dataType: { kind: 'color' }, ui: { label: 'A', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		inputB: { dataType: { kind: 'color' }, ui: { label: 'B', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		amount: { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
		blendMode: { dataType: { kind: 'blendMode' }, ui: { label: 'Blend mode', control: {} }, defaultValue: { inputSource: 'literal', value: 'add' } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
