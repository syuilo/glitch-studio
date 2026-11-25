import type { CurveAnimation } from '../curve-animation/curve-animation.ts';
import type { ExpressionEnvironment } from '../expression/expression-environment.ts';

// 再生時刻と式に公開する変数は独立。親の環境を暗黙に継承しない。
export type ParameterEvaluationScope = ExpressionEnvironment & {
	curveAnimations: readonly CurveAnimation[];
	time: number;
	endTime: number;
};
