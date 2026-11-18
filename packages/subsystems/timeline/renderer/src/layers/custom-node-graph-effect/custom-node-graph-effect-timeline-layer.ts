import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genEmptyValue } from '@gs/shared/parameter/parameter-default.ts';
import { TimelineParameterBindingEvaluator } from '@gs/subsystems_timeline_shared/parameter-binding-evaluator.ts';
import { validateEnumParameterValue } from '@gs/shared/parameter/parameter-definition.ts';
import { coerceParameterValue } from '@gs/shared/parameter/coerce-parameter-value.ts';
import { createTimelineLayerEvaluationScope } from '@gs/subsystems_timeline_shared/evaluation-scope.ts';
import { isTimelineAudioInputBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import { getTimelineCustomNodeGraphEffectArgumentDefault } from '@gs/subsystems_timeline_shared/layers/custom-node-graph-effect/custom-node-graph-effect-arguments.ts';
import { createTimelineAudioInputResolver } from '../../timeline-audio-input-resolver.ts';
import type { TimelineAudioInputProvider } from '../../timeline-audio-input-resolver.ts';
import type { CustomNodeGraphEffectPublicParameterId, CustomNodeGraphEffect } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import type { TimelineImage } from '../../timeline-image.ts';
import type { TimelineCustomNodeGraphEffectLayer, TimelineInlineCustomNodeGraphEffectLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineParameterBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { CustomNodeGraphEffectRenderContext } from '@gs/subsystems_custom-node-graph-effect_renderer/custom-node-graph-effect-renderer.ts';
import type { TimelineLayerContext, TimelineLayerRenderer } from '../../timeline-renderer.ts';
import type { AudioInput } from '@gs/subsystems_audio_shared/audio-input.ts';

// 主入力の割り当てやパラメータはCustom Node Graph Effectレイヤーだけの責務とする。
export function createCustomNodeGraphEffectTimelineLayer(
	customNodeGraphEffectSource: Pick<CustomNodeGraphEffect, 'paramDefs' | 'primaryInputId' | 'primaryAudioInputId'> | (() => Pick<CustomNodeGraphEffect, 'paramDefs' | 'primaryInputId' | 'primaryAudioInputId'>),
	layerSource: TimelineCustomNodeGraphEffectLayer | TimelineInlineCustomNodeGraphEffectLayer | (() => TimelineCustomNodeGraphEffectLayer | TimelineInlineCustomNodeGraphEffectLayer),
	renderer: {
		getAudioInput?: TimelineAudioInputProvider;
		getImageInput?: (input: TimelineImage, parameterId: CustomNodeGraphEffectPublicParameterId) => TimelineImage;
		prepare: (context: CustomNodeGraphEffectRenderContext, signal: AbortSignal) => Promise<void>;
		render: (context: CustomNodeGraphEffectRenderContext, layerContext: TimelineLayerContext<TimelineImage>, signal: AbortSignal) => ReturnType<TimelineLayerRenderer<TimelineImage>['evaluate']>;
		resetRenderHistory?: () => void;
		destroy: () => void;
	},
): TimelineLayerRenderer<TimelineImage> {
	const evaluator = new TimelineParameterBindingEvaluator();
	return {
		evaluate: async (context, signal) => {
			if (signal.aborted) return { gpuTime: 0 };
			const customNodeGraphEffect = typeof customNodeGraphEffectSource === 'function' ? customNodeGraphEffectSource() : customNodeGraphEffectSource;
			const layer = typeof layerSource === 'function' ? layerSource() : layerSource;
			const paramInputs = new Map<CustomNodeGraphEffectPublicParameterId, TimelineImage>();
			// 同じ画像を複数ポートへ渡す場合も、Scene枠への確定は一度だけ行う。
			// GPUTextureの内容は次のサンプルで変わるため、共有は今回の評価内に限る。
			const framedImageInputs = new Map<TimelineImage, TimelineImage>();
			const evaluationContext = createTimelineLayerEvaluationScope({ time: context.sceneTimeMs, isExport: context.isExport, publicParameters: context.publicParameters, automationGraphs: layer.automationGraphs });
			const evaluatedParamValues = new Map<CustomNodeGraphEffectPublicParameterId, any>();
			const audioParamInputs = new Map<CustomNodeGraphEffectPublicParameterId, AudioInput | null>();
			const resolveAudioInput = createTimelineAudioInputResolver(renderer.getAudioInput, context.sceneTimeMs, context.isExport);
			for (const def of customNodeGraphEffect.paramDefs) {
				const value = layer.customNodeGraphEffectParamValues[def.id] ?? getTimelineCustomNodeGraphEffectArgumentDefault(customNodeGraphEffect, def);
				if (value.inputSource === 'lowerLayerOutput' || value.inputSource === 'anotherLayerOutput') {
					const image = value.inputSource === 'lowerLayerOutput' ? await context.getInput()
						: await context.getLayerOutput(value.layerId, value.outputStage);
					if (signal.aborted) return { gpuTime: 0 };
					if (renderer.getImageInput != null) {
						const framedInput = framedImageInputs.get(image) ?? renderer.getImageInput(image, def.id);
						framedImageInputs.set(image, framedInput);
						paramInputs.set(def.id, framedInput);
					} else paramInputs.set(def.id, image);
					continue;
				}
				if (def.dataType.kind === 'audioSource') {
					audioParamInputs.set(def.id, isTimelineAudioInputBinding(value) ? resolveAudioInput(value) : null);
					continue;
				}
				// 空のenumキーフレームには有効な既定値が必要。保存済みの無効値は置換せず下で報告する。
				const enumFallback = value?.inputSource === 'keyframesTimelineInline' ? def.defaultValue.value : null;
				const evaluated = value == null ? def.defaultValue.value : evaluator.evaluate(value as TimelineParameterBinding, evaluationContext,
					def.dataType.kind === 'enum' ? enumFallback : value.inputSource === 'automationGraphReference' ? def.defaultValue.value : genEmptyValue(def), def);
				// prepare待機中にliteralの配列が編集されても、このフレームの値は変えない。
				evaluatedParamValues.set(def.id, coerceParameterValue(def, deepClone(validateEnumParameterValue(def, evaluated))));
			}
			// 評価ごとのローカル変数として保持し、並行するシークと共有しない。
			const resolved: CustomNodeGraphEffectRenderContext = {
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
			return renderer.render(resolved, context, signal);
		},
		resetRenderHistory: () => renderer.resetRenderHistory?.(),
		destroy: () => renderer.destroy(),
	};
}
