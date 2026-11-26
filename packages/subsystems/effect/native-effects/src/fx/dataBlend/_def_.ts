import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Blend (Data)',
	summary: {
		'ja-JP': '2つのデータを指定した合成方法で組み合わせます。',
		'en-US': 'Combines two data inputs using the selected blend mode.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite', 'math', 'utility'],
	thumbnail: { mode: 'none' },
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
			defaultValue: 1,
		},
		blendMode: { dataType: { kind: 'blendMode' }, ui: { label: 'Blend Mode', control: {} }, defaultValue: 'add' },
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameters: ['inputA'],
	outputDefs: {
		output: { dataType: { kind: 'any' } },
	},
	primaryOutput: 'output',
});
