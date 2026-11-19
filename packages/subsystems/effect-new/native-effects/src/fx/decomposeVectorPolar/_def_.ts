import { defineNativeEffect } from '@gs/subsystems_effect-new_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Decompose Vector (Polar)',
	summary: {
		'ja-JP': '2次元ベクトルを角度と長さに分解します。',
		'en-US': 'Splits a two-dimensional vector into angle and length.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['math', 'utility', 'convert'],
	paramDefs: {
		input: {
			dataType: { kind: 'vector' },
			ui: { label: 'Input', control: { controlType: 'vector' } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		angle: { dataType: { kind: 'scalar' } },
		length: { dataType: { kind: 'scalar' } },
	},
	primaryOutput: 'angle',
});
