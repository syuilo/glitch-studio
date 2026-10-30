import { getEffectIntrinsicResolution, resolveEffectStaticResources } from '@gs/subsystems_effect_renderer/effect-static-settings.ts';
import { getEffectInputResolution } from '@gs/subsystems_effect_shared/effect-resolution-inputs.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genEmptyValue } from '@gs/shared/parameter/parameter-default.ts';
import { TimelineParameterBindingEvaluator } from '@gs/subsystems_timeline_shared/parameter-binding-evaluator.ts';
import { validateEnumParameterValue } from '@gs/shared/parameter/parameter-definition.ts';
import { coerceParameterValue } from '@gs/shared/parameter/coerce-parameter-value.ts';
import { createTimelineLayerEvaluationScope } from '@gs/subsystems_timeline_shared/evaluation-scope.ts';
import { getEffectLayerParameterDefault } from '@gs/subsystems_timeline_shared/layers/effect/effect-layer.ts';
import { toShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { EffectRenderer } from '@gs/subsystems_effect_renderer/effect-renderer.ts';
import { resolveEffectParameterValue } from '@gs/subsystems_effect_renderer/effect-parameter-value.ts';
import { resolveEffectNodeResolution } from '@gs/subsystems_effect_shared/effect-node-resolution.ts';
import { mapParameterTree } from '@gs/shared/parameter/parameter-tree.ts';
import { walkParameterLeaves } from '@gs/shared/parameter/parameter-tree.ts';
import { isTimelineAudioInputBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import { createTimelineAudioInputResolver } from '../../timeline-audio-input-resolver.ts';
import { createSceneOutput } from '../../scene-output.ts';
import { createTimelineCompositor } from '../../timeline-compositor.ts';
import { TimelineCompositingParameters } from '../../timeline-compositing-parameters.ts';
import type { TimelineCompositingObserver } from '../../timeline-compositor.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { EffectImplementation, EffectGpuContext } from '@gs/subsystems_effect_shared/effect-implementation.ts';
import type { EffectInstanceState } from '@gs/subsystems_effect_shared/effect-status.ts';
import type { TimelineEffectLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineEffectParameterBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { TimelineLayerRenderer } from '../../timeline-renderer.ts';
import type { TimelineImage } from '../../timeline-image.ts';
import type { TimelineAudioInputProvider } from '../../timeline-audio-input-resolver.ts';

/** レイヤーの評価スコープ・入力・合成を所有し、エフェクト自身の実行はEffectRendererへ委ねる。 */
export function createEffectTimelineLayer(layer: TimelineEffectLayer, definition: EffectDefinition, implementation: EffectImplementation, options: {
	wgpu: EffectGpuContext;
	fallbackTexture: GPUTexture;
	/** 倍率適用済みの所属Sceneの寸法。 */
	resolution: Resolution;
	resolutionScale: number;
	assets: readonly Asset[];
	assetTextures: ReadonlyMap<string, GPUTexture>;
	getAudioInput?: TimelineAudioInputProvider;
	onState?: (state: EffectInstanceState | null) => void;
	onCompositing?: TimelineCompositingObserver | null;
}): TimelineLayerRenderer<TimelineImage> {
	// 設定更新時はManagerがインスタンスを作り直す。Bindingの検証と既定値の補完は
	// 受け入れ時に行い、毎フレーム、未評価のキーフレーム列まで複製・再検証しない。
	const port = definition.primaryOutput;
	// 出力のないエフェクトは透明画像としてreplaceせず、合成自体をスキップする。
	if (port == null) return { evaluate: async () => ({ gpuTime: 0 }), destroy() {} };
	const { device } = options.wgpu;
	const inputResolution = getEffectInputResolution<TimelineEffectParameterBinding>(definition, Object.fromEntries(Object.keys(definition.paramDefs).map(key => [key, layer.effectParamValues[key] ?? getEffectLayerParameterDefault(definition, key)])), binding =>
		binding.inputSource === 'lowerLayerOutput' || binding.inputSource === 'anotherLayerOutput' ? options.resolution : null);
	const effectResolution = resolveEffectNodeResolution({
		setting: layer.resolution, contextResolution: options.resolution, resolutionScale: options.resolutionScale,
		intrinsicResolution: layer.resolution.mode === 'auto' ? getEffectIntrinsicResolution(definition, layer.effectStaticSettings ?? {}, options) : null,
		inputResolution, maxDimension: device.limits.maxTextureDimension2D,
	});
	const renderer = new EffectRenderer({
		definition,
		implementation,
		resolution: effectResolution,
		staticResources: resolveEffectStaticResources(definition, layer.effectStaticSettings ?? {}, options),
		wgpu: options.wgpu,
		fallbackTexture: options.fallbackTexture,
		onState: options.onState,
	});
	const compositor = createTimelineCompositor({
		device,
		vertex: options.wgpu.defaultVertexShaderModule,
		onCompositing: options.onCompositing,
		resolution: options.resolution,
		format: options.wgpu.intermediateTextureFormat,
	});
	const inputFrame = createSceneOutput({
		device,
		vertex: options.wgpu.defaultVertexShaderModule,
		resolution: options.resolution,
		format: options.wgpu.intermediateTextureFormat,
	});
	// 出力段階ごとに別の確定画像を保持する。同じ変換先を使うと、複数入力の最後の画像で
	// 先に解決した入力まで上書きされてしまう。
	const referenceFrames = new Map<string, ReturnType<typeof createSceneOutput>>();
	const evaluator = new TimelineParameterBindingEvaluator();
	const compositing = new TimelineCompositingParameters();
	const usedOutputPorts = new Set([port]);
	const parameters = Object.entries(definition.paramDefs).map(([key, def]) => ({
		key,
		def,
		binding: layer.effectParamValues[key] ?? getEffectLayerParameterDefault(definition, key),
	}));
	let disposed = false;
	return {
		async evaluate(context, signal) {
			if (disposed || signal.aborted) return { gpuTime: 0 };
			const baseScope = createTimelineLayerEvaluationScope({ time: context.sceneTimeMs, isExport: context.isExport, customParameters: context.customParameters, automationGraphs: layer.automationGraphs });
			const scope = { ...baseScope, variables: { ...baseScope.variables, RESOLUTION: [effectResolution.width, effectResolution.height] } };
			const resolveAudioInput = createTimelineAudioInputResolver(options.getAudioInput, context.sceneTimeMs, context.isExport);
			const references = new Map<string, TimelineImage>();
			let lowerLayerOutput: TimelineImage | null = null;
			for (const { param: binding } of walkParameterLeaves<TimelineEffectParameterBinding>(definition.paramDefs, Object.fromEntries(parameters.map(parameter => [parameter.key, parameter.binding])))) {
				if (binding.inputSource === 'lowerLayerOutput' && lowerLayerOutput == null) lowerLayerOutput = await context.getInput();
				if (binding.inputSource !== 'anotherLayerOutput') continue;
				const key = JSON.stringify([binding.layerId, binding.outputStage]);
				if (references.has(key)) continue;
				let image = await context.getLayerOutput(binding.layerId, binding.outputStage);
				if (signal.aborted) return { gpuTime: 0 };
				{
					let frame = referenceFrames.get(key);
					if (frame == null) {
						frame = createSceneOutput({
							device,
							vertex: options.wgpu.defaultVertexShaderModule,
							resolution: options.resolution,
							format: options.wgpu.intermediateTextureFormat,
						});
						referenceFrames.set(key, frame);
					}
					image = frame.renderInput(image);
				}
				references.set(key, image);
			}
			if (signal.aborted) return { gpuTime: 0 };
			// Effectの入力は有限のSceneフレーム。中間画像の可変範囲をノードへ漏らさない。
			let input: TimelineImage | null = null;
			const getInput = () => {
				input ??= inputFrame.renderInput(lowerLayerOutput!);
				return input;
			};
			const params = Object.fromEntries(parameters.map(({ key, def, binding }) => {
				return [key, mapParameterTree<TimelineEffectParameterBinding>(def, binding, [key], (leaf, value) => {
					if (value.inputSource === 'lowerLayerOutput') return toShaderInput(getInput(), value);
					if (value.inputSource === 'anotherLayerOutput') return toShaderInput(references.get(JSON.stringify([value.layerId, value.outputStage]))!, value);
					if (isTimelineAudioInputBinding(value)) return resolveAudioInput(value);
					const fallback = value.inputSource === 'automationGraphReference' || (leaf.dataType.kind === 'enum' && value.inputSource === 'keyframesTimelineInline')
						? leaf.defaultValue.value : leaf.dataType.kind === 'enum' ? null : genEmptyValue(leaf);
					// await前に評価結果だけを固定する。literalの配列を準備中の編集と共有せず、
					// AssetやGPUリソースはこの後の変換で借用する。
					const evaluated = coerceParameterValue(leaf, deepClone(validateEnumParameterValue(leaf, evaluator.evaluate(value, scope, fallback, leaf))));
					return resolveEffectParameterValue(leaf, evaluated);
				})];
			}));
			renderer.setUsedOutputPorts(usedOutputPorts);
			renderer.prepare(params, signal);
			if (!await renderer.waitUntilReady(signal) || signal.aborted || disposed) return { gpuTime: 0 };
			const encoder = device.createCommandEncoder();
			try {
				// キー・式はScene時刻だが、エフェクト固有のアニメーションには内容時刻（秒）を渡す。
				renderer.render({
					params,
					time: context.contentTimeMs / 1000,
					timeDelta: context.timeDelta,
					pointerPosition: { x: -99999, y: -99999 },
					pointerVector: { x: 0, y: 0 },
					usedOutputPorts,
					commandEncoder: encoder,
				});
				const texture = renderer.getOutputTexture(port);
				if (texture == null) return { gpuTime: 0 };
				const settings = compositing.evaluate({
					time: context.sceneTimeMs,
					isExport: context.isExport,
					coordinateSpace: layer.coordinateSpace,
					mask: layer.mask,
					layerMask: layer.layerMask,
					transformTarget: layer.transformTarget,
					paramValues: layer.compositingParamValues,
					customParameters: context.customParameters,
					automationGraphs: layer.automationGraphs,
				});
				return { ...compositor.evaluate(context, { kind: 'texture', texture }, settings), gpuTime: 0 };
			} finally {
				// 次のフレームによる出力の再利用・破棄より先に、その出力を読む合成もsubmitする。
				device.queue.submit([encoder.finish()]);
			}
		},
		destroy() {
			disposed = true;
			renderer.dispose();
			inputFrame.dispose();
			for (const frame of referenceFrames.values()) frame.dispose();
			compositor.dispose();
		},
	};
}
