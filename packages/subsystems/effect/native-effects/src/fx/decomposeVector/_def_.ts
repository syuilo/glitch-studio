import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Decompose Vector',
	summary: {
		'ja-JP': '2次元ベクトルをX成分とY成分のスカラー値に分解します。',
		'en-US': 'Splits a two-dimensional vector into X and Y scalar components.',
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
		x: { dataType: { kind: 'scalar' } },
		y: { dataType: { kind: 'scalar' } },
	},
	primaryOutput: 'x',
});
