import type { AutomationGraph } from '../automation-graph/automation-graph.ts';
import type { ExpressionEnvironment } from '../expression/expression-environment.ts';

// 再生時刻と式に公開する変数は独立。親の環境を暗黙に継承しない。
export type ParameterEvaluationScope = ExpressionEnvironment & {
	automationGraphs: readonly AutomationGraph[];
	time: number;
	endTime: number;
};
