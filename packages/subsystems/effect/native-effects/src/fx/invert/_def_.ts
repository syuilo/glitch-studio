import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Invert',
	summary: {
		'ja-JP': '入力画像の赤・緑・青のうち、選択した成分を反転します。',
		'en-US': 'Inverts the selected red, green, and blue channels of the input image.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color'],
	thumbnail: { mode: 'defaultParameters' },
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		red: { dataType: { kind: 'bool' }, ui: { label: 'Red', control: {} }, defaultValue: true },
		green: { dataType: { kind: 'bool' }, ui: { label: 'Green', control: {} }, defaultValue: true },
		blue: { dataType: { kind: 'bool' }, ui: { label: 'Blue', control: {} }, defaultValue: true },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
