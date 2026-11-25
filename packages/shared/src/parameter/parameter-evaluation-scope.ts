import type { SharedFunctionCurve } from '../function-curve/function-curve.ts';
import type { ExpressionEnvironment } from '../expression/expression-environment.ts';

// 再生時刻と式に公開する変数は独立。親の環境を暗黙に継承しない。
export type ParameterEvaluationScope = ExpressionEnvironment & {
	functionCurves: readonly SharedFunctionCurve[];
	time: number;
	endTime: number;
};
