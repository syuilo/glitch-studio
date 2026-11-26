import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Block Shuffle',
	summary: {
		'ja-JP': '入力画像をブロックごとにランダムにずらします。',
		'en-US': 'Randomly shifts blocks of the input image.',
	},
	kind: 'modify',
	thumbnail: { mode: 'customParameters', params: { density: [9, 9] } },
	dependsOnRenderHistory: false,
	tags: ['glitch'],
	paramDefs: {
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
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: 0.5,
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
			canNode: true,
			defaultValue: [20, 20],
		},
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: 'longSide' },
		randomSwap: { dataType: { kind: 'bool' }, ui: { label: 'Random Swap', control: {} }, defaultValue: true },
		randomRotation: { dataType: { kind: 'bool' }, ui: { label: 'Random Rotation', control: {} }, defaultValue: false },
		randomFlipX: { dataType: { kind: 'bool' }, ui: { label: 'Random Flip X', control: {} }, defaultValue: false },
		randomFlipY: { dataType: { kind: 'bool' }, ui: { label: 'Random Flip Y', control: {} }, defaultValue: false },
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: 0 },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
