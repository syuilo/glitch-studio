import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genEmptyValue } from '@gs/shared/parameter/parameter-default.ts';
import { TimelineParameterBindingEvaluator } from '@gs/subsystems_timeline_shared/parameter-binding-evaluator.ts';
import { validateEnumParameterValue } from '@gs/shared/parameter/parameter-definition.ts';
import { coerceParameterValue } from '@gs/shared/parameter/coerce-parameter-value.ts';
import { createTimelineLayerEvaluationScope } from '@gs/subsystems_timeline_shared/evaluation-scope.ts';
import { isTimelineAudioInputBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import { getTimelineVisualModuleArgumentDefault } from '@gs/subsystems_timeline_shared/layers/visual-module/visual-module-arguments.ts';
import { createTimelineAudioInputResolver } from '../../timeline-audio-input-resolver.ts';
import type { TimelineAudioInputProvider } from '../../timeline-audio-input-resolver.ts';
import type { VisualModuleCustomParameterId, VisualModule } from '@gs/subsystems_visual-module_shared/types.ts';
import type { TimelineImage } from '../../timeline-image.ts';
import type { TimelineVisualModuleLayer, TimelineInlineVisualModuleLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineParameterBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { VisualModuleRenderContext } from '@gs/subsystems_visual-module_renderer/visual-module-renderer.ts';
import type { TimelineLayerContext, TimelineLayerRenderer } from '../../timeline-renderer.ts';
import type { AudioInput } from '@gs/subsystems_audio_shared/audio-input.ts';

// 主入力の割り当てやパラメータはVisual Moduleレイヤーだけの責務とする。
export function createVisualModuleTimelineLayer(
	moduleSource: Pick<VisualModule, 'paramDefs' | 'primaryInputId' | 'primaryAudioInputId'> | (() => Pick<VisualModule, 'paramDefs' | 'primaryInputId' | 'primaryAudioInputId'>),
	layerSource: TimelineVisualModuleLayer | TimelineInlineVisualModuleLayer | (() => TimelineVisualModuleLayer | TimelineInlineVisualModuleLayer),
	renderer: {
		getAudioInput?: TimelineAudioInputProvider;
		getImageInput?: (input: TimelineImage, parameterId: VisualModuleCustomParameterId, sceneFrame: boolean) => TimelineImage;
		prepare: (context: VisualModuleRenderContext, signal: AbortSignal) => Promise<void>;
		render: (context: VisualModuleRenderContext, layerContext: TimelineLayerContext<TimelineImage>) => ReturnType<TimelineLayerRenderer<TimelineImage>['evaluate']>;
		destroy: () => void;
	},
): TimelineLayerRenderer<TimelineImage> {
	const evaluator = new TimelineParameterBindingEvaluator();
	return {
		lazyInput: true,
		evaluate: async (context, signal) => {
			if (signal.aborted) return { gpuTime: 0 };
			const visualModule = typeof moduleSource === 'function' ? moduleSource() : moduleSource;
			const layer = typeof layerSource === 'function' ? layerSource() : layerSource;
			const paramInputs = new Map<VisualModuleCustomParameterId, TimelineImage>();
			const evaluationContext = createTimelineLayerEvaluationScope({ time: context.sceneTimeMs, isExport: context.isExport, automationGraphs: layer.automationGraphs });
			const evaluatedParamValues = new Map<VisualModuleCustomParameterId, any>();
			const audioParamInputs = new Map<VisualModuleCustomParameterId, AudioInput | null>();
			const resolveAudioInput = createTimelineAudioInputResolver(renderer.getAudioInput, context.sceneTimeMs, context.isExport);
			for (const def of visualModule.paramDefs) {
				const value = layer.visualModuleParamValues[def.id] ?? getTimelineVisualModuleArgumentDefault(visualModule, def);
				if (value.inputSource === 'layerInput' || value.inputSource === 'anotherLayerOutput') {
					const image = value.inputSource === 'layerInput' ? await context.getInput?.() ?? context.input
						: await context.getLayerOutput?.(value.layerId, value.outputStage) ?? { kind: 'uniform' as const, value: [0, 0, 0, 0] };
					if (signal.aborted) return { gpuTime: 0 };
					paramInputs.set(def.id, renderer.getImageInput?.(image, def.id,
						value.inputSource === 'layerInput' || value.outputStage !== 'source' || image.region != null) ?? image);
					continue;
				}
				if (def.dataType.kind === 'audioSource') {
					audioParamInputs.set(def.id, isTimelineAudioInputBinding(value) ? resolveAudioInput(value) : null);
					continue;
				}
				// 空のenumキーフレームには有効な既定値が必要。保存済みの無効値は置換せず下で報告する。
				const enumFallback = value?.inputSource === 'keyframesTimelineInline' ? def.defaultValue.value : null;
				const evaluated = value == null ? def.defaultValue.value : evaluator.evaluate(value as TimelineParameterBinding, evaluationContext,
					def.dataType.kind === 'enum' ? enumFallback : value.inputSource === 'automationGraphReference' ? def.defaultValue.value : genEmptyValue(def));
				// prepare待機中にliteralの配列が編集されても、このフレームの値は変えない。
				evaluatedParamValues.set(def.id, coerceParameterValue(def, deepClone(validateEnumParameterValue(def, evaluated))));
			}
			// 評価ごとのローカル変数として保持し、並行するシークと共有しない。
			const resolved: VisualModuleRenderContext = {
				isExport: context.isExport,
				time: context.contentTimeMs,
				timeDelta: context.timeDelta,
				endTime: context.contentEndTimeMs,
				progress: context.clipElapsedTimeMs / context.clipDurationMs,
				evaluatedParamValues,
				audioParamInputs,
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
