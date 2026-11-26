import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Mix (Color)',
	summary: {
		'ja-JP': '2つの画像を指定した割合で混ぜ合わせます。',
		'en-US': 'Mixes two images at the specified ratio.',
	},
	kind: 'modify',
	thumbnail: { mode: 'defaultParameters', inputs: { inputA: 'sceneA', inputB: 'sceneB' } },
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
			defaultValue: 0.5,
		},
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameters: ['inputA'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
