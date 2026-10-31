import { defineEffect } from '../../effect-definition.ts';
import { scalarMathOperationIds, scalarMathOperationLabels } from './operations.ts';

export default defineEffect({
	id: 'scalarMath',
	displayName: 'Scalar Math',
	description: {
		'ja-JP': 'スカラー場を画素ごとに計算します。演算に応じてA・B・Cを使い、三角関数の角度は1で1周です。StepはAと閾値B、SmoothstepはAと境界B・Cを使います。0除算・負数の平方根・実数で定義できない累乗・Tangentの特異点は0になります。自動解像度は演算で未使用の入力も含め、A・B・Cの全接続から決まります。',
		'en-US': 'Evaluates scalar fields per pixel using A, B, and C as needed. Trigonometric angles use turns. Step compares A against B; Smoothstep maps A between B and C. Division by zero, negative square roots, non-real powers, and tangent singularities return zero. Automatic resolution considers all connections to A, B, and C, including inputs unused by the operation.',
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
