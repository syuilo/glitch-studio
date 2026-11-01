import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'decomposeVectorPolar',
	displayName: 'Decompose Vector (Polar)',
	description: {
		'ja-JP': '2次元ベクトルを角度と長さに分解します。上向きが0、時計回りに1で1周です。ゼロベクトルの角度は0です。空間ベクトルは長辺全体を1とする共通の等方座標で扱います。',
		'en-US': 'Splits a two-dimensional vector into angle and length. Angle zero points up and one turn is clockwise. Zero vectors return angle zero. Spatial vectors use common isotropic units, with one unit spanning the full longest side.',
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
