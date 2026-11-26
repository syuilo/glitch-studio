import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Color Blocks',
	summary: {
		'ja-JP': '入力画像にランダムな色のブロックを重ねます。',
		'en-US': 'Overlays randomly colored blocks on the input image.',
	},
	kind: 'modify',
	thumbnail: { mode: 'defaultParameters' },
	dependsOnRenderHistory: false,
	tags: ['color', 'glitch'],
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: 'longSide' },
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
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
					max: 100,
					step: 1,
				},
			},
			defaultValue: 50,
		},
		alphaRandomness: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Alpha Randomness',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: 1,
		},
		density: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Density',
				control: {
					controlType: 'dimension',
					min: 1,
					max: 1000,
					logarithmic: true,
				},
			},
			defaultValue: [3, 3],
		},
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: 0 },
		rgb: { dataType: { kind: 'bool' }, ui: { label: 'RGB', control: {} }, defaultValue: true },
		cmy: { dataType: { kind: 'bool' }, ui: { label: 'CMY', control: {} }, defaultValue: true },
		black: { dataType: { kind: 'bool' }, ui: { label: 'Black', control: {} }, defaultValue: true },
		white: { dataType: { kind: 'bool' }, ui: { label: 'White', control: {} }, defaultValue: true },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
