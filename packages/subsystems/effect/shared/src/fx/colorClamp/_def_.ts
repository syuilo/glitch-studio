import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'colorClamp',
	displayName: 'Color Clamp',
	description: {
		'ja-JP': '入力画像のRGB成分の範囲を制限し、色や明るさを抑えます。',
		'en-US': 'Limits the range of RGB channels to constrain colors and brightness in the input image.',
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
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
