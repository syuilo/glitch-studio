import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'composeColorHsl',
	displayName: 'Compose Color (HSL)',
	description: {
		'ja-JP': '色相（1で1周）・彩度・明度・アルファのスカラー入力を組み合わせ、色を作ります。',
		'en-US': 'Combines hue in turns, saturation, lightness, and alpha scalar inputs into a color.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['color', 'utility', 'convert'],
	paramDefs: {
		hue: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Hue', control: { controlType: 'angle' } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		saturation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Saturation', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		lightness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Lightness', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
		alpha: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Alpha', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
	},
	primaryInputParameter: null,
	resolutionInputParameter: null,
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
