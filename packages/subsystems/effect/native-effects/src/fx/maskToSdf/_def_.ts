import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Mask to SDF',
	summary: {
		'ja-JP': 'スカラーマスクの輪郭から符号付き距離場を生成します。',
		'en-US': 'Generates a signed distance field from the contour of a scalar mask.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['math', 'convert', 'sdf'],
	paramDefs: {
		input: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Input', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: 0,
		},
		threshold: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Threshold', control: { controlType: 'number', step: 0.01 } },
			defaultValue: 0.5,
		},
		invert: {
			dataType: { kind: 'bool' },
			ui: { label: 'Invert', control: {} },
			defaultValue: false,
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'scalar' } } },
	primaryOutput: 'output',
});
