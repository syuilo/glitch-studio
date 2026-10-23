import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'decomposeColorHsl',
	displayName: 'Decompose Color (HSL)',
	description: {
		'ja-JP': '未乗算のRGBを0〜1へ制限し、色相（1で1周）・彩度・明度・アルファのスカラー値に分解します。無彩色の色相と、完全に透明な画素のHSLは0になります。',
		'en-US': 'Clamps straight RGB to 0–1 and splits it into hue in turns, saturation, lightness, and alpha scalar values. Achromatic hue and fully transparent HSL are zero.',
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
	resolutionInputParameter: 'input',
	outputDefs: {
		hue: { dataType: { kind: 'scalar' } },
		saturation: { dataType: { kind: 'scalar' } },
		lightness: { dataType: { kind: 'scalar' } },
		alpha: { dataType: { kind: 'scalar' } },
	},
	primaryOutput: 'hue',
});
