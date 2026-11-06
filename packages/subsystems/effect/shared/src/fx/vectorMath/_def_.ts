import { defineEffect } from '../../effect-definition.ts';
import { vectorMathOperationIds, vectorMathOperationLabels } from './operations.ts';

export default defineEffect({
	id: 'vectorMath',
	displayName: 'Vector Math',
	description: {
		'ja-JP': 'ベクトル場の四則演算・スカラー倍・回転などで、座標や変位を加工します。',
		'en-US': 'Transforms coordinate and displacement fields using vector arithmetic, scaling, rotation, and mathematical functions.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['math', 'utility'],
	paramDefs: {
		operation: {
			dataType: { kind: 'enum', options: vectorMathOperationIds },
			ui: { label: 'Operation', control: { labels: vectorMathOperationLabels } },
			defaultValue: { inputSource: 'literal', value: 'add' },
		},
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
		scale: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Scale', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		angle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Angle', control: { controlType: 'angle' } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
	},
	primaryInputParameter: 'inputA',
	// 演算を式やアニメーションで切り替えても、解像度やRESOLUTIONを変化させない。
	// Scalar Mathと同じく、選択中の演算で未使用の入力も静的な算定に含める。
	resolutionInputParameters: ['inputA', 'inputB', 'scale', 'angle'],
	outputDefs: { output: { dataType: { kind: 'vector' } } },
	primaryOutput: 'output',
});
