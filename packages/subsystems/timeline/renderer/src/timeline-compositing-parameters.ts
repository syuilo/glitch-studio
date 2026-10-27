import type { TimelineLayerCustomParameterContext } from '@gs/subsystems_timeline_shared/custom-parameters.ts';
import { colorBlendModes, isBlendMode } from '@gs/shared/color-blend.ts';
import { genEmptyValue } from '@gs/shared/parameter/parameter-default.ts';
import { coerceParameterValue } from '@gs/shared/parameter/coerce-parameter-value.ts';
import { timelineCompositingParamDefs, type TimelineLayerCoordinateSpace, type TimelineLayerTransformTarget, type TimelineMask, type TimelineLayerMask } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { TimelineParameterBindingEvaluator } from '@gs/subsystems_timeline_shared/parameter-binding-evaluator.ts';
import { createTimelineLayerEvaluationScope } from '@gs/subsystems_timeline_shared/evaluation-scope.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { FitMode } from '@gs/shared/types.ts';
import type { TimelineParameterBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';

export type TimelineCompositingSettings = {
	transformTarget: TimelineLayerTransformTarget;
	coordinateSpace: TimelineLayerCoordinateSpace;
	mask: TimelineMask | null;
	layerMask: TimelineLayerMask | null;
	depth: number;
	clipToFrame: boolean;
	blendMode: number;
	opacity: number;
	fitMode: FitMode;
	position: [number, number];
	origin: [number, number];
	scale: [number, number];
	rotation: number;
};

export class TimelineCompositingParameters {
	private evaluator = new TimelineParameterBindingEvaluator();

	evaluate(context: { time: number; isExport: boolean; coordinateSpace: TimelineLayerCoordinateSpace; mask: TimelineMask | null; layerMask: TimelineLayerMask | null; transformTarget?: TimelineLayerTransformTarget; paramValues: Record<string, TimelineParameterBinding>; automationGraphs: AutomationGraph[]; customParameters?: TimelineLayerCustomParameterContext | null }): TimelineCompositingSettings {
		const evaluationContext = createTimelineLayerEvaluationScope(context);
		const values = new Map<string, any>();
		for (const [key, def] of Object.entries(timelineCompositingParamDefs)) {
			const value = context.paramValues[key];
			// 未指定・欠落グラフには設定の既定値を使う。式の失敗は例外として上位へ伝える。
			values.set(key, coerceParameterValue(def, value == null ? def.defaultValue.value : this.evaluator.evaluate(value, evaluationContext,
				value.inputSource === 'automationGraphReference' || key === 'fitMode' ? def.defaultValue.value : genEmptyValue(def), def)));
		}
		// 不正な式の型や非有限値をGPUへ流さない。範囲外の有限な位置・倍率は制限しない。
		const number = (id: string, fallback: number) => {
			const value = values.get(id);
			return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
		};
		const vector = (id: string, fallback: [number, number]): [number, number] => {
			const value = values.get(id);
			return fallback.map((component, index) => Array.isArray(value) && typeof value[index] === 'number' && Number.isFinite(value[index]) ? value[index] : component) as [number, number];
		};
		const mode = values.get('blendMode');
		const fitMode = values.get('fitMode');
		return {
			transformTarget: context.transformTarget ?? 'image',
			coordinateSpace: context.coordinateSpace,
			mask: context.mask == null ? null : { ...context.mask },
			layerMask: context.layerMask == null ? null : { ...context.layerMask },
			depth: number('depth', 0),
			clipToFrame: values.get('clipToFrame') === true,
			blendMode: isBlendMode(mode) ? colorBlendModes[mode] : 0,
			opacity: Math.min(1, Math.max(0, number('opacity', 1))),
			// 範囲はSceneの矩形を基準にする。保存したFitは画像モードへ戻したときに再び使う。
			fitMode: context.transformTarget === 'region' ? 'stretch' : fitMode === 'contain' || fitMode === 'cover' || fitMode === 'stretch' ? fitMode : timelineCompositingParamDefs.fitMode.defaultValue.value,
			position: vector('position', [0, 0]),
			origin: vector('origin', [0, 0]),
			scale: vector('scale', [1, 1]),
			rotation: number('rotation', 0),
		};
	}
}
