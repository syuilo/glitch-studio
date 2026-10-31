import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'normalizeVector',
	displayName: 'Normalize Vector',
	description: {
		'ja-JP': '2次元ベクトルの方向を保って長さを1に揃えます。ゼロベクトルはゼロのままです。描画先の比率では補正しません。',
		'en-US': 'Normalizes a two-dimensional vector to unit length in component coordinates. Zero vectors remain zero; no render aspect ratio correction is applied.',
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
