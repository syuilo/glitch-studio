import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'blockShiftGlitch',
	displayName: 'Block Shift Glitch',
	description: {
		'ja-JP': '入力画像をブロックごとに上下・左右へランダムな量だけシフトします。',
		'en-US': 'Shifts blocks of the input image horizontally and vertically by random amounts.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['glitch', 'pixel', 'gimmicky', 'experimental'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
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
			defaultValue: { inputSource: 'literal', value: 0.5 },
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
			defaultValue: { inputSource: 'literal', value: 0.5 },
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
			defaultValue: { inputSource: 'literal', value: [20, 20] },
		},
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
		horizontalShift: { dataType: { kind: 'bool' }, ui: { label: 'Horizontal Shift', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		verticalShift: { dataType: { kind: 'bool' }, ui: { label: 'Vertical Shift', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
