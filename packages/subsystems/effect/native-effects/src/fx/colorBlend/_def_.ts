import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Blend (Color)',
	summary: {
		'ja-JP': '2つの画像を指定した合成方法で重ね合わせます。',
		'en-US': 'Combines two images using the selected blend mode.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color', 'composite', 'utility'],
	paramDefs: {
		inputA: {
			dataType: { kind: 'color' },
			ui: { label: 'A', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		inputB: {
			dataType: { kind: 'color' },
			ui: { label: 'B', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
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
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
