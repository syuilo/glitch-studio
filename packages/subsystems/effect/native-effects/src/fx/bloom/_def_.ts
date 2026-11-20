import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Bloom',
	summary: {
		'ja-JP': '入力画像の明るい部分をにじませ、光の広がりを加えます。',
		'en-US': 'Spreads light from bright areas of the input image to create a glow.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['blur', 'light'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		inputBlendMode: { dataType: { kind: 'blendMode' }, ui: { label: 'Input Blend', control: {} }, defaultValue: 'emission' },
		strength: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Strength',
				control: {
					controlType: 'range',
					min: 0,
					max: 5,
					step: 0.01,
				},
			},
			defaultValue: 1,
		},
		threshold: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Threshold',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: 0.7,
		},
		softKnee: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Soft Knee',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: 0.5,
		},
		radius: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Radius',
				control: {
					controlType: 'dimension',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: [0.7, 0.7],
		},
		quality: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Quality',
				control: {
					controlType: 'range',
					min: 0.1,
					max: 1,
					step: 0.05,
				},
			},
			defaultValue: 0.5,
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
