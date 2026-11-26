import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Vector Chromatic Aberration',
	summary: {
		'ja-JP': '入力したベクトル場に沿ってRGBチャンネルをずらし、色収差を作ります。',
		'en-US': 'Shifts RGB channels along an input vector field to create chromatic aberration.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color', 'distortion', 'glitch'],
	thumbnail: { mode: 'defaultParameters' },
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
			defaultValue: 0.1,
		},
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: 'longSide' },
		rStrength: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'R Strength',
				control: {
					controlType: 'range',
					min: -10,
					max: 10,
					step: 0.01,
				},
			},
			defaultValue: 1,
		},
		gStrength: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'G Strength',
				control: {
					controlType: 'range',
					min: -10,
					max: 10,
					step: 0.01,
				},
			},
			defaultValue: 1.5,
		},
		bStrength: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'B Strength',
				control: {
					controlType: 'range',
					min: -10,
					max: 10,
					step: 0.01,
				},
			},
			defaultValue: 2,
		},
		samples: { dataType: { kind: 'scalar' }, ui: { label: 'Samples', control: { controlType: 'number', min: 1, max: 100 } }, defaultValue: 32 },
		vector: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Vector',
				control: {
					controlType: 'vector',
					step: 0.01,
					min: -5,
					max: 5,
				},
			},
			canNode: true,
			defaultValue: [1, 0],
		},
		normalize: { dataType: { kind: 'bool' }, ui: { label: 'Normalize', control: {} }, defaultValue: false },
		inputBlendMode: { dataType: { kind: 'blendMode' }, ui: { label: 'Input Blend', control: {} }, defaultValue: 'replace' },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
