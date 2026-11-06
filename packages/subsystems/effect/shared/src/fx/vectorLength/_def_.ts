import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'vectorLength',
	displayName: 'Vector Length',
	description: {
		'ja-JP': '2次元ベクトルの長さをスカラー値として出力します。',
		'en-US': 'Outputs the length of a two-dimensional vector as a scalar value.',
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
