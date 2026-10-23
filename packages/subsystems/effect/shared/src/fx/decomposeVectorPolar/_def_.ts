import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'decomposeVectorPolar',
	displayName: 'Decompose Vector (Polar)',
	description: {
		'ja-JP': '2次元ベクトルを角度と長さに分解します。上向きが0、時計回りに1で1周です。ゼロベクトルの角度は0です。描画先の比率では補正しません。',
		'en-US': 'Splits a two-dimensional vector into angle and length in component coordinates. Zero points up; one turn is clockwise. Zero vectors have angle zero; no render aspect ratio correction is applied.',
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
	resolutionInputParameter: 'input',
	outputDefs: {
		angle: { dataType: { kind: 'scalar' } },
		length: { dataType: { kind: 'scalar' } },
	},
	primaryOutput: 'angle',
});
