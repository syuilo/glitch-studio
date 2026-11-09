import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'oklchAdjust',
	displayName: 'OKLCH Adjust',
	description: {
		'ja-JP': 'OKLCHの明度Lの加算・クロマCの倍率・色相Hの回転を調整します。色域外の値も保持します。',
		'en-US': 'Adjusts OKLCH lightness offset, chroma multiplier, and hue rotation without clipping out-of-gamut values.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		lightness: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Lightness Offset',
				control: {
					controlType: 'range',
					min: -1,
					max: 1,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		chroma: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Chroma',
				control: {
					controlType: 'range',
					min: 0,
					max: 4,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		hue: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Hue',
				control: { controlType: 'angle' },
			},
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
