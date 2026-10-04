import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'dataBlend',
	displayName: 'Blend (Data)',
	description: {
		'ja-JP': '2つのデータを指定した合成方法で組み合わせます。',
		'en-US': 'Combines two data inputs using the selected blend mode.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite', 'math', 'utility'],
	paramDefs: {
		inputA: { dataType: { kind: 'any' }, ui: { label: 'A', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: null } },
		inputB: { dataType: { kind: 'any' }, ui: { label: 'B', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: null } },
		amount: { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
		blendMode: { dataType: { kind: 'blendMode' }, ui: { label: 'Blend mode', control: {} }, defaultValue: { inputSource: 'literal', value: 'add' } },
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameter: 'inputA',
	outputDefs: {
		output: { dataType: { kind: 'any' } },
	},
	primaryOutput: 'output',
});
