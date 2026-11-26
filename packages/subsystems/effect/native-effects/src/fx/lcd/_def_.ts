import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'LCD',
	summary: {
		'ja-JP': '入力画像を液晶ディスプレイのRGBサブピクセル風に表現します。',
		'en-US': 'Renders the input image as RGB subpixels like an LCD screen.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['pattern', 'stylized'],
	thumbnail: { mode: 'customParameters', params: { density: 25, border: 0.16 } },
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: 'longSide' },
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		density: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Density',
				control: {
					controlType: 'range',
					min: 1,
					max: 1000,
					logarithmic: true,
				},
			},
			defaultValue: 200,
		},
		border: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Border',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: 0.1,
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
