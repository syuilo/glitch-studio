import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'vectorDotProduct',
	displayName: 'Vector Dot Product',
	description: {
		'ja-JP': '2つのベクトル場の内積を計算し、スカラー場として出力します。',
		'en-US': 'Computes the dot product of two vector fields and outputs a scalar field.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['math', 'utility'],
	paramDefs: {
		inputA: {
			dataType: { kind: 'vector' },
			ui: { label: 'A', control: { controlType: 'vector', min: -1, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		inputB: {
			dataType: { kind: 'vector' },
			ui: { label: 'B', control: { controlType: 'vector', min: -1, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameters: ['inputA', 'inputB'],
	outputDefs: { output: { dataType: { kind: 'scalar' } } },
	primaryOutput: 'output',
});
