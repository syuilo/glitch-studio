import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'vectorLength',
	displayName: 'Vector Length',
	description: {
		'ja-JP': '2次元ベクトルのユークリッド長をスカラー値として出力します。各成分の値から計算します。空間ベクトルは長辺全体を1とする共通の等方座標で扱います。',
		'en-US': 'Outputs the Euclidean length of a two-dimensional vector. Spatial vectors use common isotropic units, with one unit spanning the full longest side.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['math', 'utility'],
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
	outputDefs: { output: { dataType: { kind: 'scalar' } } },
	primaryOutput: 'output',
});
