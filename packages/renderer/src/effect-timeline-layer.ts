import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { genEmptyValue } from '@glitch/shared/utility/misc.ts';
import { ParameterEvaluator } from '@glitch/shared/parameter-evaluator.ts';
import { validateEnumParameterValue } from '@glitch/shared/parameter.ts';
import { constantShaderInput } from '@glitch/shared/shader-input.ts';
import { createTimelineLayerEvaluationScope } from '@glitch/shared/timeline/evaluation-scope.ts';
import { getEffectLayerParameterDefault } from '@glitch/shared/timeline/effect-layer.ts';
import { validateTimelineParameterTree } from '@glitch/shared/timeline/parameter-binding.ts';
import { EffectRenderer } from './effect-renderer.ts';
import { resolveEffectNodeResolution } from './effect-node-resolution.ts';
import { mapNodeParam } from './utility/node-params.ts';
import { outputShaderInput } from './node-output.ts';
import { createTimelineCompositor } from './timeline-compositor.ts';
import { TimelineCompositingParameters } from './timeline-compositing-parameters.ts';
import type { EffectDefinition } from '@glitch/shared/effect/effect-definition.ts';
import type { EffectImplementation, EffectGpuContext } from '@glitch/shared/effect/effect-implementation.ts';
import type { EffectInstanceState } from '@glitch/shared/effect/effect-status.ts';
import type { TimelineEffectLayer } from '@glitch/shared/timeline/types.ts';
import type { Resolution } from '@glitch/shared/resolution.ts';
import type { Asset } from '@glitch/shared/types.ts';
import type { TimelineLayerRenderer } from './timeline-renderer.ts';
import type { NodeOutput } from './node-output.ts';

/** レイヤーの評価スコープ・入力・合成を所有し、エフェクト自身の実行はEffectRendererへ委ねる。 */
export function createEffectTimelineLayer(layer: TimelineEffectLayer, definition: EffectDefinition, implementation: EffectImplementation, options: {
	wgpu: EffectGpuContext;
	fallbackTexture: GPUTexture;
	/** 倍率適用済みの所属Sceneの寸法。 */
	resolution: Resolution;
	resolutionScale: number;
	assets: readonly Asset[];
	assetTextures: ReadonlyMap<string, GPUTexture>;
	onState?: (state: EffectInstanceState | null) => void;
}): TimelineLayerRenderer<NodeOutput> {
	const port = definition.primaryOutput;
	// 出力のないエフェクトは透明画像としてreplaceせず、合成自体をスキップする。
	if (port == null) return { evaluate: async () => ({ gpuTime: 0 }), destroy() {} };
	const { device } = options.wgpu;
	const renderer = new EffectRenderer({ definition, implementation, wgpu: options.wgpu,
		fallbackTexture: options.fallbackTexture, onState: options.onState });
	const compositor = createTimelineCompositor({ device, vertex: options.wgpu.defaultVertexShaderModule,
		resolution: options.resolution, format: options.wgpu.intermediateTextureFormat });
	const evaluator = new ParameterEvaluator();
	const compositing = new TimelineCompositingParameters();
	const usedOutputPorts = new Set([port]);
	let disposed = false;
	return {
		async evaluate(context, signal) {
			if (disposed || signal.aborted) return { gpuTime: 0 };
			const scope = { ...createTimelineLayerEvaluationScope({ time: context.sceneTimeMs, isExport: context.isExport,
				automationGraphs: layer.automationGraphs }), evaluatedParamValues: null };
			const params = Object.fromEntries(Object.entries(definition.paramDefs).map(([key, def]) => {
				// 非同期準備中の編集や別シークと値を共有しない。GPUリソースだけは借用する。
				const binding = deepClone(layer.effectParamValues[key] ?? getEffectLayerParameterDefault(definition, key));
				validateTimelineParameterTree(def, binding, true);
				return [key, mapNodeParam(def, binding, [key], (leaf, value) => {
					if (value.inputSource === 'layerInput') return outputShaderInput(context.input, value);
					const fallback = value.inputSource === 'automationGraphReference' || (leaf.dataType.kind === 'enum' && value.inputSource === 'keyframesTimelineInline')
						? leaf.defaultValue.value : leaf.dataType.kind === 'enum' ? undefined : genEmptyValue(leaf);
					const evaluated = deepClone(validateEnumParameterValue(leaf, evaluator.evaluate(value, scope, fallback)));
					if (leaf.dataType.kind === 'assetReference') return options.assetTextures.get(evaluated) ?? null;
					if (leaf.dataType.kind === 'videoAssetReference') return options.assets.find(asset => asset.id === evaluated && asset.fileDataType.startsWith('video/')) ?? null;
					if (leaf.dataType.kind === 'fontAssetReference') return options.assets.find(asset => asset.id === evaluated && asset.fileDataType.startsWith('font/')) ?? null;
					// タイムラインにはPlayerの再生状態を持ち込まない。
					if (leaf.dataType.kind === 'playerReference') return null;
					return leaf.canNode ? constantShaderInput(leaf.dataType.kind, evaluated) : evaluated;
				})];
			}));
			const resolutionInput = definition.resolutionInputParameter == null ? undefined : params[definition.resolutionInputParameter];
			renderer.setUsedOutputPorts(usedOutputPorts);
			renderer.setResolution(resolveEffectNodeResolution({ setting: layer.resolution,
				contextResolution: options.resolution, resolutionScale: options.resolutionScale,
				intrinsicResolution: layer.resolution.mode === 'auto' ? implementation.getIntrinsicResolution?.(params) : undefined,
				inputResolution: resolutionInput?.kind === 'texture' ? resolutionInput.texture : undefined,
				maxDimension: device.limits.maxTextureDimension2D }));
			renderer.prepare(params);
			if (!await renderer.waitUntilReady(signal) || signal.aborted || disposed) return { gpuTime: 0 };
			const encoder = device.createCommandEncoder();
			try {
				// キー・式はScene時刻だが、エフェクト固有のアニメーションには内容時刻（秒）を渡す。
				renderer.render({ params, time: context.contentTimeMs / 1000, timeDelta: context.timeDelta,
					pointerPosition: { x: -99999, y: -99999 }, pointerVector: { x: 0, y: 0 },
					usedOutputPorts, commandEncoder: encoder });
				const texture = renderer.getOutputTexture(port);
				if (texture == null) return { gpuTime: 0 };
				const settings = compositing.evaluate({ time: context.sceneTimeMs, isExport: context.isExport,
					paramValues: layer.compositingParamValues, automationGraphs: layer.automationGraphs });
				return { output: compositor.render(encoder, context.input, { kind: 'texture', texture }, settings), gpuTime: 0 };
			} finally {
				// 次のフレームによる出力の再利用・破棄より先に、その出力を読む合成もsubmitする。
				device.queue.submit([encoder.finish()]);
			}
		},
		destroy() {
			disposed = true;
			renderer.dispose();
			compositor.dispose();
		},
	};
}
