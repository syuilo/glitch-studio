import type { ParameterId } from '@glitch/shared/parameter-identity.ts';
import { ParameterEvaluator } from './parameter-evaluator.ts';
import { layerVariables } from './expression-scope.ts';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { genEmptyValue } from '@glitch/shared/utility/misc.ts';
import type { NodeOutput } from './node-output.ts';
import type { TimelineVisualModuleLayer, VisualModule } from '@glitch/shared/types.ts';
import type { VisualModuleRenderContext } from './visual-module-renderer.ts';
import type { TimelineLayerContext, TimelineLayerRenderer } from './timeline-renderer.ts';

// 主入力の割り当てやパラメータはVisual Moduleレイヤーだけの責務とする。
export function createVisualModuleTimelineLayer(
	visualModule: Pick<VisualModule, 'paramDefs'>,
	layer: TimelineVisualModuleLayer,
	renderer: {
		prepare: (context: VisualModuleRenderContext, signal: AbortSignal) => Promise<void>;
		render: (context: VisualModuleRenderContext, layerContext: TimelineLayerContext<NodeOutput>) => ReturnType<TimelineLayerRenderer<NodeOutput>['render']>;
		destroy: () => void;
	},
): TimelineLayerRenderer<NodeOutput> {
	// prepareとrenderは同じオブジェクトを渡し、評価結果を再利用する。
	// 並行するシークのコンテキストを上書きしないよう、入力ごとに保持する。
	const contexts = new WeakMap<TimelineLayerContext<NodeOutput>, VisualModuleRenderContext>();
	const evaluator = new ParameterEvaluator();
	const resolveContext = (context: TimelineLayerContext<NodeOutput>): VisualModuleRenderContext => {
		let resolved = contexts.get(context);
		if (resolved == null) {
			const paramInputs = new Map(visualModule.paramDefs.filter(def => def.isPrimaryInput).map(def => [def.id, context.input]));
			const evaluationContext = {
				evaluatedParamValues: null,
				variables: layerVariables({ isExport: context.isExport }),
				automationGraphs: layer.automationGraphs,
				time: context.time, endTime: context.endTime,
			};
			const evaluatedParamValues = new Map<ParameterId, any>();
			for (const def of visualModule.paramDefs) {
				// 主入力はuniformでもCPU式には公開せず、Inノードからのみ読む。
				if (paramInputs.has(def.id)) continue;
				const value = layer.paramValues[def.id];
				const evaluated = value == null ? def.defaultValue.value : evaluator.evaluate(value, evaluationContext,
					value.inputSource === 'automationGraphReference' ? def.defaultValue.value : genEmptyValue(def));
				// prepare待機中にliteralの配列が編集されても、このフレームの値は変えない。
				evaluatedParamValues.set(def.id, deepClone(evaluated));
			}
			resolved = {
				isExport: context.isExport,
				time: context.time,
				timeDelta: context.timeDelta,
				endTime: context.endTime,
				evaluatedParamValues,
				paramInputs,
				pointerPosition: { x: -99999, y: -99999 },
				pointerPositionPrev: { x: -99999, y: -99999 },
			};
			contexts.set(context, resolved);
		}
		return resolved;
	};
	return {
		prepare: (context, signal) => renderer.prepare(resolveContext(context), signal),
		render: context => renderer.render(resolveContext(context), context),
		destroy: () => renderer.destroy(),
	};
}
