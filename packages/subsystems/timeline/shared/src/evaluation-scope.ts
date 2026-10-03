import type { LAYER_VAR_DEFS } from './expression.ts';
import type { ParameterEvaluationScope } from '@gs/shared/parameter/parameter-evaluation-scope.ts';

type TimelineEvaluationContext = Pick<ParameterEvaluationScope, 'time' | 'automationGraphs'> & { isExport: boolean };

/** 映像・音声ともに所属Sceneの時刻で評価する。クリップの時刻や終端は継承しない。 */
export function createTimelineLayerEvaluationScope(context: TimelineEvaluationContext): ParameterEvaluationScope {
	return {
		time: context.time,
		// レイヤーには終端がない。Automation Graphも開始基準だけを利用する。
		endTime: Infinity,
		automationGraphs: context.automationGraphs,
		variables: {
			TIME: context.time / 1000,
			TIME_MS: context.time,
			TEST_ONLY_LAYER: true,
			TEST_SAME_NAME: 2,
			IS_EXPORT: context.isExport,
		} satisfies Record<typeof LAYER_VAR_DEFS[number], unknown>,
	};
}
