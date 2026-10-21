import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'colorClamp',
	displayName: 'Color Clamp',
	description: {
		'ja-JP': '入力画像の赤・緑・青それぞれの成分を、指定した下限と上限の範囲に制限します。',
		'en-US': 'Limits the red, green, and blue channels of the input image to individually specified minimum and maximum values.',
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
		rMax: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Max (Red)',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		rMin: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Min (Red)',
				control: {
					controlType: 'range',
					min: -1,
					max: 0,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: { inputSource: 'literal', value: -1 },
		},
		gMax: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Max (Green)',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		gMin: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Min (Green)',
				control: {
					controlType: 'range',
					min: -1,
					max: 0,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: { inputSource: 'literal', value: -1 },
		},
		bMax: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Max (Blue)',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		bMin: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Min (Blue)',
				control: {
					controlType: 'range',
					min: -1,
					max: 0,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: { inputSource: 'literal', value: -1 },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
