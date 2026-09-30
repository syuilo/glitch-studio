import type { LAYER_VAR_DEFS } from '../expression.ts';
import type { EvaluationScope } from '../parameter-evaluator.ts';
import type { AUDIO_LAYER_VAR_DEFS } from './timeline-audio.ts';

type TimelineEvaluationContext = Pick<EvaluationScope, 'time' | 'endTime' | 'automationGraphs'> & { isExport: boolean };

/** レイヤー引数・合成設定・Scene音量のスコープ。時刻はautomation用で、式には公開しない。 */
export function createTimelineLayerEvaluationScope(context: TimelineEvaluationContext): EvaluationScope {
	return {
		time: context.time,
		endTime: context.endTime,
		automationGraphs: context.automationGraphs,
		variables: {
			TEST_ONLY_LAYER: true,
			TEST_SAME_NAME: 2,
			IS_EXPORT: context.isExport,
		} satisfies Record<typeof LAYER_VAR_DEFS[number], unknown>,
	};
}

/** 音声素材の内容時刻・長さを公開する。親SceneやVisual Moduleの変数は継承しない。 */
export function createAudioLayerEvaluationScope(context: TimelineEvaluationContext): EvaluationScope {
	return {
		time: context.time,
		endTime: context.endTime,
		automationGraphs: context.automationGraphs,
		variables: {
			TIME: context.time / 1000,
			TIME_MS: context.time,
			END_TIME: context.endTime / 1000,
			END_TIME_MS: context.endTime,
			PROGRESS: context.time / context.endTime,
			IS_EXPORT: context.isExport,
		} satisfies Record<typeof AUDIO_LAYER_VAR_DEFS[number], unknown>,
	};
}
