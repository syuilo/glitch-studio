import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Block Shift Glitch',
	summary: {
		'ja-JP': '入力画像をブロックごとに上下・左右へランダムな量だけシフトします。',
		'en-US': 'Shifts blocks of the input image horizontally and vertically by random amounts.',
	},
	kind: 'modify',
	thumbnail: { mode: 'customParameters', params: { density: [13, 13], strength: 0.75 } },
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
		strength: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Strength',
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
		horizontalShift: { dataType: { kind: 'bool' }, ui: { label: 'Horizontal Shift', control: {} }, defaultValue: true },
		verticalShift: { dataType: { kind: 'bool' }, ui: { label: 'Vertical Shift', control: {} }, defaultValue: false },
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: 0 },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
