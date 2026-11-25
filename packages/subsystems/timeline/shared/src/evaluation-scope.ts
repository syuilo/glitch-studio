import type { LAYER_VAR_DEFS } from './expression.ts';
import type { ParameterEvaluationScope } from '@gs/shared/parameter/parameter-evaluation-scope.ts';
import type { TimelineLayerPublicParameterContext } from './public-parameters.ts';

export type TimelineEvaluationContext = Pick<ParameterEvaluationScope, 'time' | 'curveAnimations'> & { isExport: boolean; publicParameters?: TimelineLayerPublicParameterContext | null };
export type TimelineLayerEvaluationScope = ParameterEvaluationScope & { publicParameters?: TimelineLayerPublicParameterContext | null };

/** 映像・音声ともに所属Sceneの時刻で評価する。クリップの時刻や終端は継承しない。 */
export function createTimelineLayerEvaluationScope(context: TimelineEvaluationContext): TimelineLayerEvaluationScope {
	return {
		publicParameters: context.publicParameters,
		time: context.time,
		// レイヤーには終端がない。Curve Animationも開始基準だけを利用する。
		endTime: Infinity,
		curveAnimations: context.curveAnimations,
		variables: {
			TIME: context.time / 1000,
			TIME_MS: context.time,
			TEST_ONLY_LAYER: true,
			TEST_SAME_NAME: 2,
			IS_EXPORT: context.isExport,
		} satisfies Record<typeof LAYER_VAR_DEFS[number], unknown>,
	};
}
