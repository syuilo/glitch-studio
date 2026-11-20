import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Frame Difference',
	summary: {
		'ja-JP': '現在の入力と前のフレームの差を取り、変化した部分を抽出します。',
		'en-US': 'Extracts changes by comparing the current input with the previous frame.',
	},
	kind: 'modify',
	// 差分を次のフレームで0に戻すため、入力が変わらないフレームも比較と履歴の更新が必要。
	dependsOnRenderHistory: true,
	tags: ['temporal', 'analysis', 'utility'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		mode: { dataType: { kind: 'enum', options: ['rgb', 'luminance'] }, ui: { label: 'Mode', control: { labels: { 'rgb': 'RGB', 'luminance': 'Luminance' } } }, defaultValue: 'rgb' },
		gain: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Gain',
				control: {
					controlType: 'range',
					min: 0,
					max: 10,
					step: 0.01,
				},
			},
			defaultValue: 1,
		},
		threshold: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Threshold',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.001,
				},
			},
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
