import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'dataBlend',
	displayName: 'Blend (Data)',
	tags: [],
	primaryInputParameter: 'inputA',
	paramDefs: {
		inputA: { dataType: { kind: 'any' }, ui: { label: 'A', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: null } },
		inputB: { dataType: { kind: 'any' }, ui: { label: 'B', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: null } },
		amount: { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
		blendMode: { dataType: { kind: 'blendMode' }, ui: { label: 'Blend mode', control: {} }, defaultValue: { inputSource: 'literal', value: 'add' } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'any' } },
	},
});
