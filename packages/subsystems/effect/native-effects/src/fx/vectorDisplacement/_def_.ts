import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Vector Displacement',
	summary: {
		'ja-JP': '入力したベクトル場に沿って画像を変形します。',
		'en-US': 'Warps the input image using a vector field.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['distortion', 'utility'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		vector: {
			dataType: { kind: 'vector' },
			ui: { label: 'Vector', control: { controlType: 'vector', min: -1, max: 1 } },
			canNode: true,
			defaultValue: [0, 0],
		},
		amount: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Amount',
				control: {
					controlType: 'range',
					min: -1,
					max: 1,
					step: 0.001,
				},
			},
			defaultValue: 0.05,
		},
		flipX: { dataType: { kind: 'bool' }, ui: { label: 'Flip X', control: {} }, defaultValue: false },
		flipY: { dataType: { kind: 'bool' }, ui: { label: 'Flip Y', control: {} }, defaultValue: false },
		rotation: { dataType: { kind: 'scalar' }, ui: { label: 'Rotation', control: { controlType: 'angle' } }, defaultValue: 0 },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
