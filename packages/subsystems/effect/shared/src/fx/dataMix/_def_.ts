import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'dataMix',
	displayName: 'Mix (Data)',
	description: {
		'ja-JP': '2つのデータを指定した割合で混ぜ合わせます。',
		'en-US': 'Mixes two data inputs at the specified ratio.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite', 'math', 'utility'],
	paramDefs: {
		inputA: { dataType: { kind: 'any' }, ui: { label: 'A', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: null } },
		inputB: { dataType: { kind: 'any' }, ui: { label: 'B', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: null } },
		amount: { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0.5 } },
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameter: 'inputA',
	outputDefs: {
		output: { dataType: { kind: 'any' } },
	},
	primaryOutput: 'output',
});
