import { defineEffect } from '../../effect-definition.ts';
import { scalarMathOperationIds, scalarMathOperationLabels } from './operations.ts';

export default defineEffect({
	id: 'scalarMath',
	displayName: 'Scalar Math',
	description: {
		'ja-JP': 'スカラー場に四則演算や数学関数を適用し、値や模様を加工します。',
		'en-US': 'Applies arithmetic and mathematical functions to scalar fields to modify values and patterns.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['math', 'utility'],
	paramDefs: {
		operation: {
			dataType: { kind: 'enum', options: scalarMathOperationIds },
			ui: { label: 'Operation', control: { labels: scalarMathOperationLabels } },
			defaultValue: { inputSource: 'literal', value: 'add' },
		},
		inputA: {
			dataType: { kind: 'scalar' },
			ui: { label: 'A', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		inputB: {
			dataType: { kind: 'scalar' },
			ui: { label: 'B', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		inputC: {
			dataType: { kind: 'scalar' },
			ui: { label: 'C', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
	},
	primaryInputParameter: 'inputA',
	// Operationは式やアニメーションでも変わるため、評価前に全接続から解像度を固定する。
	// 未使用のB/Cも算定対象にし、演算の切り替えで寸法やRESOLUTIONが変わらないようにする。
	resolutionInputParameters: ['inputA', 'inputB', 'inputC'],
	outputDefs: { output: { dataType: { kind: 'scalar' } } },
	primaryOutput: 'output',
});
