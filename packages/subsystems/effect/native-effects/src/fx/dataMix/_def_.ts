import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Mix (Data)',
	summary: {
		'ja-JP': '2つのデータを指定した割合で混ぜ合わせます。',
		'en-US': 'Mixes two data inputs at the specified ratio.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite', 'math', 'utility'],
	paramDefs: {
		inputA: {
			dataType: { kind: 'any' },
			ui: { label: 'A', control: {} },
			canNode: true,
			defaultValue: null,
		},
		inputB: {
			dataType: { kind: 'any' },
			ui: { label: 'B', control: {} },
			canNode: true,
			defaultValue: null,
		},
		amount: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Amount',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: 0.5,
		},
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameters: ['inputA'],
	outputDefs: {
		output: { dataType: { kind: 'any' } },
	},
	primaryOutput: 'output',
});
