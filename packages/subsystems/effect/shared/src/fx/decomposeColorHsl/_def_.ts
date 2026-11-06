import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'decomposeColorHsl',
	displayName: 'Decompose Color (HSL)',
	description: {
		'ja-JP': '色を色相・彩度・明度・アルファのスカラー値に分解します。',
		'en-US': 'Splits a color into hue, saturation, lightness, and alpha scalar values.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color', 'utility', 'convert'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		hue: { dataType: { kind: 'scalar' } },
		saturation: { dataType: { kind: 'scalar' } },
		lightness: { dataType: { kind: 'scalar' } },
		alpha: { dataType: { kind: 'scalar' } },
	},
	primaryOutput: 'hue',
});
