import { ExpressionEvaluator } from '@gs/shared/expression/expression-evaluator.ts';
import { createResolutionExpressionVariables } from '@gs/shared/expression/resolution-variables.ts';
import { toShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { genEmptyValue } from '@gs/shared/parameter/parameter-default.ts';
import { validateEnumParameterValue } from '@gs/shared/parameter/parameter-definition.ts';
import { mapParameterTree, walkParameterLeaves } from '@gs/shared/parameter/parameter-tree.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { createEffectRenderInstance } from '@gs/subsystems_effect-new_renderer/create-effect-render-instance.ts';
import type { EffectRenderEnvironment, EffectRenderRequest } from '@gs/subsystems_effect-new_renderer/effect-render-instance.ts';
import type { EffectCatalog } from '@gs/subsystems_effect-new_shared/effect-catalog.ts';
import { createTimelineLayerEvaluationScope } from '@gs/subsystems_timeline_shared/evaluation-scope.ts';
import { getEffectLayerParameterDefault, getTimelineEffectLayerDefinition, getTimelineEffectLayerOutputId } from '@gs/subsystems_timeline_shared/layers/effect/effect-layer.ts';
import { resolveTimelineEffectLayerResolution } from '@gs/subsystems_timeline_shared/layers/effect/effect-layer-resolution.ts';
import { isTimelineAudioInputBinding, isTimelineImageInputBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { TimelineEffectParameterBinding, TimelineLowerLayerOutputBinding, TimelineAnotherLayerOutputBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import { TimelineParameterBindingEvaluator } from '@gs/subsystems_timeline_shared/parameter-binding-evaluator.ts';
import type { TimelineEffectLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { createSceneOutput } from '../../scene-output.ts';
import { createTimelineAudioInputResolver } from '../../timeline-audio-input-resolver.ts';
import type { TimelineAudioInputProvider } from '../../timeline-audio-input-resolver.ts';
import { TimelineCompositingParameters } from '../../timeline-compositing-parameters.ts';
import { createTimelineCompositor } from '../../timeline-compositor.ts';
import type { TimelineCompositingObserver } from '../../timeline-compositor.ts';
import type { TimelineImage } from '../../timeline-image.ts';
import type { TimelineLayerContext, TimelineLayerEvaluation, TimelineLayerRenderer } from '../../timeline-renderer.ts';

function imageSourceKey(binding: TimelineLowerLayerOutputBinding | TimelineAnotherLayerOutputBinding): string {
	return binding.inputSource === 'lowerLayerOutput' ? 'lowerLayerOutput' : JSON.stringify([binding.layerId, binding.outputStage]);
}

/** Effectの種類に関わらず、レイヤーが入力の取得・Scene時刻の引数評価と出力の合成を所有する。 */
export function createEffectTimelineLayer(layer: TimelineEffectLayer, catalog: EffectCatalog, options: EffectRenderEnvironment & {
	vertex: GPUShaderModule;
	/** 倍率適用済みの所属Sceneの寸法。 */
	resolution: Resolution;
	resolutionScale: number;
	getAudioInput?: TimelineAudioInputProvider;
	resolveAudioSource?: EffectRenderRequest['resolveAudioSource'];
	onCompositing?: TimelineCompositingObserver | null;
}): TimelineLayerRenderer<TimelineImage> {
	const definition = getTimelineEffectLayerDefinition(layer, catalog);
	const outputId = getTimelineEffectLayerOutputId(definition);
	const outputIds = new Set([outputId]);
	const effectResolution = resolveTimelineEffectLayerResolution(layer.resolution, options.resolution, options.resolutionScale);
	const defaultBindings = new Map(Object.keys(definition.paramDefs).map(id => [id, getEffectLayerParameterDefault(definition, id)]));
	const getBinding = (id: string) => Object.hasOwn(layer.effectParamValues, id) ? layer.effectParamValues[id] : defaultBindings.get(id)!;

	// 画像を受け取れる公開ポートには、入力の取得前からSceneフレームの寸法を宣言できる。
	// ノードの配線・寸法・入力元の変更時には新しい配置を作る。
	const inputResolutions = new Map<string, Resolution>();
	for (const [id, parameter] of Object.entries(definition.paramDefs)) {
		if (parameter.canNode === true && isTimelineImageInputBinding(getBinding(id))) inputResolutions.set(id, options.resolution);
	}
	const instance = createEffectRenderInstance(catalog, layer.effect, options, { resolution: effectResolution, inputResolutions });
	const evaluator = new TimelineParameterBindingEvaluator();
	const expressionEngine = new ExpressionEvaluator();
	const compositing = new TimelineCompositingParameters();
	let evaluationLifetime = new AbortController();
	let compositor: ReturnType<typeof createTimelineCompositor> | null = null;
	const frames = new Map<string, ReturnType<typeof createSceneOutput>>();

	async function evaluateFrame(context: TimelineLayerContext<TimelineImage>, signal: AbortSignal): Promise<TimelineLayerEvaluation<TimelineImage>> {
		// この配置で使うのは主色出力だけ。子グラフのデータ出力だけに必要な入力元まで待たない。
		const required = instance.getRequiredParameterIds?.(outputIds) ?? Object.keys(definition.paramDefs);
		const parameterIds = [...required];
		const definitions = Object.fromEntries(parameterIds.map(id => [id, definition.paramDefs[id]]));
		const bindings = Object.fromEntries(parameterIds.map(id => [id, getBinding(id)]));
		await instance.prepare(outputIds);
		if (signal.aborted) return { gpuTime: 0 };
		const images = new Map<string, TimelineImage>();
		for (const { param: binding } of walkParameterLeaves<TimelineEffectParameterBinding>(definitions, bindings)) {
			if (!isTimelineImageInputBinding(binding)) continue;
			const key = imageSourceKey(binding);
			if (images.has(key)) continue;
			const image = binding.inputSource === 'lowerLayerOutput' ? await context.getInput() : await context.getLayerOutput(binding.layerId, binding.outputStage);
			if (signal.aborted) return { gpuTime: 0 };
			images.set(key, image);
		}

		// 全ての非同期待機の後で素材を確定し、同じ区間内でEffectのコマンドを送信する。
		// 別のシークが確定用のテクスチャやuniformバッファを更新する余地を残さない。
		for (const [key, image] of images) {
			let frame = frames.get(key);
			if (frame == null) {
				frame = createSceneOutput({ device: options.device, vertex: options.vertex, resolution: options.resolution });
				frames.set(key, frame);
			}
			images.set(key, frame.renderInput(image));
		}
		const baseScope = createTimelineLayerEvaluationScope({ time: context.sceneTimeMs, isExport: context.isExport, publicParameters: context.publicParameters, automationGraphs: layer.automationGraphs });
		const scope = { ...baseScope, variables: { ...baseScope.variables, ...createResolutionExpressionVariables(effectResolution) } };
		const resolveAudioInput = createTimelineAudioInputResolver(options.getAudioInput, context.sceneTimeMs, context.isExport);
		const parameters = new Map<string, unknown>();
		for (const id of parameterIds) {
			parameters.set(id, mapParameterTree<TimelineEffectParameterBinding>(definitions[id], bindings[id], [], (leaf, binding) => {
				if (isTimelineImageInputBinding(binding)) return toShaderInput(images.get(imageSourceKey(binding))!, binding);
				if (isTimelineAudioInputBinding(binding)) return resolveAudioInput(binding);
				const fallback = binding.inputSource === 'automationGraphReference' || (leaf.dataType.kind === 'enum' && binding.inputSource === 'keyframesTimelineInline')
					? leaf.defaultValue.value : leaf.dataType.kind === 'enum' ? null : genEmptyValue(leaf);
				return deepClone(validateEnumParameterValue(leaf, evaluator.evaluate(binding, scope, fallback, leaf)));
			}));
		}
		if (signal.aborted) return { gpuTime: 0 };
		const commandEncoder = options.device.createCommandEncoder();
		const outputs = instance.render({
			commandEncoder, parameters, outputIds, expressionEngine, resolveAudioSource: options.resolveAudioSource,
			time: context.contentTimeMs / 1000, endTime: context.contentEndTimeMs / 1000,
		});
		options.device.queue.submit([commandEncoder.finish()]);
		const image = outputs.get(outputId);
		// 公開ポートがあっても未接続なら、このレイヤーの合成をスキップする。
		if (image == null) return { gpuTime: 0 };
		const settings = compositing.evaluate({
			time: context.sceneTimeMs, isExport: context.isExport, publicParameters: context.publicParameters, automationGraphs: layer.automationGraphs,
			coordinateSpace: layer.coordinateSpace, mask: layer.mask, layerMask: layer.layerMask, transformTarget: layer.transformTarget, paramValues: layer.compositingParamValues,
		});
		compositor ??= createTimelineCompositor(options);
		return compositor.evaluate(context, image, settings);
	}

	return {
		async evaluate(context, frameSignal) {
			const signal = AbortSignal.any([frameSignal, evaluationLifetime.signal]);
			if (signal.aborted) return { gpuTime: 0 };
			// 中断済みのフレームは、コンパイルや参照先の画像待ちが終わる前に呼び出し元へ返す。
			const cancelled = Promise.withResolvers<TimelineLayerEvaluation<TimelineImage>>();
			const abort = () => cancelled.resolve({ gpuTime: 0 });
			signal.addEventListener('abort', abort, { once: true });
			try {
				return await Promise.race([evaluateFrame(context, signal), cancelled.promise]);
			} finally {
				signal.removeEventListener('abort', abort);
			}
		},
		resetRenderHistory() {
			if (evaluationLifetime.signal.aborted) return;
			// リセット前に始めた非同期評価が、新しい履歴を進めることを防ぐ。
			evaluationLifetime.abort();
			evaluationLifetime = new AbortController();
			instance.resetRenderHistory();
		},
		destroy() {
			if (evaluationLifetime.signal.aborted) return;
			evaluationLifetime.abort();
			instance.destroy();
			for (const frame of frames.values()) frame.dispose();
			frames.clear();
			compositor?.dispose();
		},
	};
}
