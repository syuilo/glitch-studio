import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'normalizeVector',
	displayName: 'Normalize Vector',
	description: {
		'ja-JP': '2次元ベクトルの方向を保って長さを1に揃えます。ゼロベクトルはゼロのままです。空間ベクトルは長辺全体を1とする共通の等方座標で扱います。',
		'en-US': 'Normalizes a two-dimensional vector to length one. Zero vectors remain zero. Spatial vectors use common isotropic units, with one unit spanning the full longest side.',
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
	outputDefs: { output: { dataType: { kind: 'vector' } } },
	primaryOutput: 'output',
});
