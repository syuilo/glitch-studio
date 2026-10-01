import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { genEmptyValue } from '@glitch/shared/utility/misc.ts';
import { ParameterEvaluator } from '@glitch/shared/parameter-evaluator.js';
import { validateEnumParameterValue } from '@glitch/shared/parameter.ts';
import { createTimelineLayerEvaluationScope } from '@glitch/shared/timeline/evaluation-scope.ts';
import type { VisualModuleCustomParameterId, VisualModule } from '@glitch/shared/visual-module/types.ts';
import type { NodeOutput } from './node-output.ts';
import type { TimelineVisualModuleLayer, TimelineInlineVisualModuleLayer } from '@glitch/shared/timeline/types.ts';
import type { VisualModuleRenderContext } from './visual-module-renderer.ts';
import type { TimelineLayerContext, TimelineLayerRenderer } from './timeline-renderer.ts';

// 主入力の割り当てやパラメータはVisual Moduleレイヤーだけの責務とする。
export function createVisualModuleTimelineLayer(
	visualModule: Pick<VisualModule, 'paramDefs' | 'primaryInputId'>,
	layer: TimelineVisualModuleLayer | TimelineInlineVisualModuleLayer,
	renderer: {
		prepare: (context: VisualModuleRenderContext, signal: AbortSignal) => Promise<void>;
		render: (context: VisualModuleRenderContext, layerContext: TimelineLayerContext<NodeOutput>) => ReturnType<TimelineLayerRenderer<NodeOutput>['evaluate']>;
		destroy: () => void;
	},
): TimelineLayerRenderer<NodeOutput> {
	const evaluator = new ParameterEvaluator();
	return {
		evaluate: async (context, signal) => {
			if (signal.aborted) return { gpuTime: 0 };
			const paramInputs = new Map<VisualModuleCustomParameterId, NodeOutput>();
			if (visualModule.primaryInputId !== null) paramInputs.set(visualModule.primaryInputId, context.input);
			const evaluationContext = {
				...createTimelineLayerEvaluationScope({ ...context, automationGraphs: layer.automationGraphs }),
				evaluatedParamValues: null,
			};
			const evaluatedParamValues = new Map<VisualModuleCustomParameterId, any>();
			for (const def of visualModule.paramDefs) {
				// 主入力はuniformでもCPU式には公開せず、Inノードからのみ読む。
				if (paramInputs.has(def.id)) continue;
				const value = layer.paramValues[def.id];
				const evaluated = value == null ? def.defaultValue.value : evaluator.evaluate(value, evaluationContext,
					def.dataType.kind === 'enum' ? undefined : value.inputSource === 'automationGraphReference' ? def.defaultValue.value : genEmptyValue(def));
				// prepare待機中にliteralの配列が編集されても、このフレームの値は変えない。
				evaluatedParamValues.set(def.id, deepClone(validateEnumParameterValue(def, evaluated)));
			}
			// 評価ごとのローカル変数として保持し、並行するシークと共有しない。
			const resolved: VisualModuleRenderContext = {
				isExport: context.isExport,
				time: context.time,
				timeDelta: context.timeDelta,
				endTime: context.endTime,
				evaluatedParamValues,
				paramInputs,
				pointerPosition: { x: -99999, y: -99999 },
				pointerPositionPrev: { x: -99999, y: -99999 },
			};
			await renderer.prepare(resolved, signal);
			if (signal.aborted) return { gpuTime: 0 };
			return renderer.render(resolved, context);
		},
		destroy: () => renderer.destroy(),
	};
}
