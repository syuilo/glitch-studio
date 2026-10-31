import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'vectorLength',
	displayName: 'Vector Length',
	description: {
		'ja-JP': '2次元ベクトルのユークリッド長をスカラー値として出力します。各成分の値をそのまま使い、描画先の比率では補正しません。',
		'en-US': 'Outputs the Euclidean length of a two-dimensional vector in component coordinates, without render aspect ratio correction.',
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
