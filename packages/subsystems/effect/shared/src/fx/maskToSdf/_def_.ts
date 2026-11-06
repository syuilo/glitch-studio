import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'maskToSdf',
	displayName: 'Mask to SDF',
	description: {
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
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		threshold: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Threshold', control: { controlType: 'number', step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
		invert: {
			dataType: { kind: 'bool' },
			ui: { label: 'Invert', control: {} },
			defaultValue: { inputSource: 'literal', value: false },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'scalar' } } },
	primaryOutput: 'output',
});
