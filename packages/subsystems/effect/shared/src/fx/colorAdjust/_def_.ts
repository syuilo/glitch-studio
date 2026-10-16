import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'colorAdjust',
	displayName: 'Color Adjust',
	description: {
		'ja-JP': '入力画像の明るさ・明度・コントラスト・色相・彩度を調整します。',
		'en-US': 'Adjusts the brightness, lightness, contrast, hue, and saturation of the input image.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color'],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		lightness: { dataType: { kind: 'scalar' }, ui: { label: 'Lightness', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		contrast: { dataType: { kind: 'scalar' }, ui: { label: 'Contrast', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
		hue: { dataType: { kind: 'scalar' }, ui: { label: 'Hue', control: { controlType: 'angle' } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		brightness: { dataType: { kind: 'scalar' }, ui: { label: 'Brightness', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
		saturation: { dataType: { kind: 'scalar' }, ui: { label: 'Saturation', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
