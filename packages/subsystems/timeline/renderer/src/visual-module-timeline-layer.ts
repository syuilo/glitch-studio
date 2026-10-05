import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genEmptyValue } from '@gs/shared/parameter/parameter-default.ts';
import { TimelineParameterBindingEvaluator } from '@gs/subsystems_timeline_shared/parameter-binding-evaluator.ts';
import { validateEnumParameterValue } from '@gs/shared/parameter/parameter-definition.ts';
import { createTimelineLayerEvaluationScope } from '@gs/subsystems_timeline_shared/evaluation-scope.ts';
import { validateTimelineParameterTree } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import { getTimelineVisualModuleArgumentDefault } from '@gs/subsystems_timeline_shared/visual-module-arguments.ts';
import type { VisualModuleCustomParameterId, VisualModule } from '@gs/subsystems_visual-module_shared/types.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { TimelineVisualModuleLayer, TimelineInlineVisualModuleLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { VisualModuleRenderContext } from '@gs/subsystems_visual-module_renderer/visual-module-renderer.ts';
import type { TimelineLayerContext, TimelineLayerRenderer } from './timeline-renderer.ts';
import type { AudioInput } from '@gs/subsystems_audio_shared/audio-input.ts';

// 主入力の割り当てやパラメータはVisual Moduleレイヤーだけの責務とする。
export function createVisualModuleTimelineLayer(
	moduleSource: Pick<VisualModule, 'paramDefs' | 'primaryInputId' | 'primaryAudioInputId'> | (() => Pick<VisualModule, 'paramDefs' | 'primaryInputId' | 'primaryAudioInputId'>),
	layerSource: TimelineVisualModuleLayer | TimelineInlineVisualModuleLayer | (() => TimelineVisualModuleLayer | TimelineInlineVisualModuleLayer),
	renderer: {
		getAudioInput?: (sceneTimeMs: number, isExport: boolean) => AudioInput;
		prepare: (context: VisualModuleRenderContext, signal: AbortSignal) => Promise<void>;
		render: (context: VisualModuleRenderContext, layerContext: TimelineLayerContext<UniformOrTexture>) => ReturnType<TimelineLayerRenderer<UniformOrTexture>['evaluate']>;
		destroy: () => void;
	},
): TimelineLayerRenderer<UniformOrTexture> {
	const evaluator = new TimelineParameterBindingEvaluator();
	return {
		evaluate: async (context, signal) => {
			if (signal.aborted) return { gpuTime: 0 };
			const visualModule = typeof moduleSource === 'function' ? moduleSource() : moduleSource;
			const layer = typeof layerSource === 'function' ? layerSource() : layerSource;
			const paramInputs = new Map<VisualModuleCustomParameterId, UniformOrTexture>();
			if (visualModule.primaryInputId !== null) paramInputs.set(visualModule.primaryInputId, context.input);
			const evaluationContext = createTimelineLayerEvaluationScope({ time: context.sceneTimeMs, isExport: context.isExport, automationGraphs: layer.automationGraphs });
			const evaluatedParamValues = new Map<VisualModuleCustomParameterId, any>();
			const audioParamInputs = new Map<VisualModuleCustomParameterId, AudioInput | null>();
			let audioInput: AudioInput | undefined;
			if (visualModule.primaryAudioInputId != null && !visualModule.paramDefs.some(def => def.id === visualModule.primaryAudioInputId && def.dataType.kind === 'audioSource' && !def.canNode)) throw new Error('Invalid primary audio input');
			for (const def of visualModule.paramDefs) {
				// 主入力はuniformでもCPU式には公開せず、Inノードからのみ読む。
				if (paramInputs.has(def.id)) continue;
				const value = layer.visualModuleParamValues[def.id] ?? getTimelineVisualModuleArgumentDefault(visualModule, def);
				validateTimelineParameterTree(def, value, false, true);
				if (def.dataType.kind === 'audioSource') {
					if (value.inputSource === 'lowerLayerAudio') {
						if (!renderer.getAudioInput) throw new Error('Timeline audio input is unavailable');
						audioInput ??= renderer.getAudioInput(context.sceneTimeMs, context.isExport);
						audioParamInputs.set(def.id, audioInput);
					} else audioParamInputs.set(def.id, null);
					continue;
				}
				if (value.inputSource === 'lowerLayerAudio') throw new Error('Expected audio parameter');
				// 空のenumキーフレームには有効な既定値が必要。保存済みの無効値は置換せず下で報告する。
				const enumFallback = value?.inputSource === 'keyframesTimelineInline' ? def.defaultValue.value : undefined;
				const evaluated = value == null ? def.defaultValue.value : evaluator.evaluate(value, evaluationContext,
					def.dataType.kind === 'enum' ? enumFallback : value.inputSource === 'automationGraphReference' ? def.defaultValue.value : genEmptyValue(def));
				// prepare待機中にliteralの配列が編集されても、このフレームの値は変えない。
				evaluatedParamValues.set(def.id, deepClone(validateEnumParameterValue(def, evaluated)));
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
