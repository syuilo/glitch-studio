import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Transform',
	summary: {
		'ja-JP': '入力画像を移動・回転・拡大縮小します。',
		'en-US': 'Translates, rotates, and scales the input image.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['transform', 'utility'],
	thumbnail: {
		mode: 'customParameters',
		params: { scale: [0.72, 0.72], rotation: 0.055 },
	},
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		// ±1で長辺全体1つ分の移動。これはUIの操作範囲であり、入力値自体は制限しない。
		translation: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Translation',
				control: {
					controlType: 'vector',
					min: -1,
					max: 1,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: [0, 0],
		},
		scale: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Scale',
				control: {
					controlType: 'dimension',
					min: -1,
					max: 4,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: [1, 1],
		},
		rotation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Rotation', control: { controlType: 'angle' } },
			canNode: true,
			defaultValue: 0,
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
