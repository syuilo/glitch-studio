import { scaleResolution, type Resolution } from '@gs/shared/resolution.ts';
import { createResolutionExpressionVariables } from '@gs/shared/expression/resolution-variables.ts';
import { createStaticSettingValues } from '@gs/shared/static-setting.ts';
import { createEffectInstance, type EffectPlacement } from '@gs/subsystems_effect_renderer/create-effect-instance.ts';
import { resolveEffectSource } from '@gs/subsystems_effect_shared/effect-source.ts';
import { resolveEffectNodeResolution } from '@gs/subsystems_effect_shared/effect-node-resolution.ts';
import { getTimelineEffectOutput } from '@gs/subsystems_timeline_shared/layers/effect/effect-layer.ts';
import { createTimelineLayerEvaluationScope } from '@gs/subsystems_timeline_shared/evaluation-scope.ts';
import { createTimelineCompositor, type TimelineCompositingObserver } from '../../timeline-compositor.ts';
import { TimelineCompositingParameters } from '../../timeline-compositing-parameters.ts';
import { createEffectLayerInputs } from './effect-layer-inputs.ts';
import type { EffectGpuContext, EffectInstance, EffectFrameContext, NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type { EffectRenderTilingProgressObserver } from '@gs/subsystems_effect_shared/effect-render-tiling.ts';
import type { TimelineEffectLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineAudioInputProvider } from '../../timeline-audio-input-resolver.ts';
import type { TimelineLayerContext, TimelineLayerRenderer } from '../../timeline-renderer.ts';
import type { TimelineImage } from '../../timeline-image.ts';

type EffectTimelineLayerOptions = Pick<EffectPlacement, 'definitions' | 'resources' | 'tiling' | 'onGpuTime' | 'onPreparationStatus'> & {
	wgpu: EffectGpuContext;
	getNativeEffectImplementation: (id: string) => NativeEffectImplementation;
	/** 所属Sceneの倍率適用前の基準寸法。 */
	sceneBaseResolution: Resolution;
	resolutionScale: number;
	getAudioInput?: TimelineAudioInputProvider;
	applyPendingEffectValues?: (instance: EffectInstance) => void;
	onTilingProgress?: EffectRenderTilingProgressObserver;
	onCompositing?: TimelineCompositingObserver | null;
};

/** レイヤーの評価スコープ・入力・合成を所有し、Effectの実行はEffectInstanceへ委ねる。 */
export function createEffectTimelineLayer(layer: TimelineEffectLayer, options: EffectTimelineLayerOptions): TimelineLayerRenderer<TimelineImage> {
	const { device, defaultVertexShaderModule: vertex } = options.wgpu;
	const { definition } = resolveEffectSource(layer.effectSource, options.definitions);
	const port = getTimelineEffectOutput(definition);
	const resolution = scaleResolution(options.sceneBaseResolution, options.resolutionScale);
	const staticSettings = createStaticSettingValues(definition.staticSettingDefs ?? {}, layer.effectStaticSettings);
	const intrinsicKey = definition.intrinsicResolutionSetting;
	const sourceId = intrinsicKey == null ? null : staticSettings[intrinsicKey];
	let intrinsic: Resolution | null = null;
	if (layer.resolution.mode === 'auto' && intrinsicKey != null && typeof sourceId === 'string') {
		intrinsic = options.resources?.assets.find(asset => asset.id === sourceId) ?? null;
	}
	// Timelineの画像入力はすべてScene寸法。autoの寸法を求めるだけの入力から、下層の描画を起動しない。
	const setting = layer.resolution.mode === 'auto' && intrinsic == null ? { mode: 'context', scale: layer.resolution.scale } as const : layer.resolution;
	const effectResolution = resolveEffectNodeResolution({
		setting, contextResolution: () => resolution, resolutionScale: options.resolutionScale,
		intrinsicResolution: intrinsic, maxDimension: device.limits.maxTextureDimension2D,
	});
	const variables = createResolutionExpressionVariables(effectResolution);
	const inputs = createEffectLayerInputs(layer, definition, { device, vertex, resolution }, options.getAudioInput);
	const compositor = createTimelineCompositor({ device, vertex, resolution, onCompositing: options.onCompositing });
	const compositing = new TimelineCompositingParameters();
	const lifetime = new AbortController();
	let initialization: Promise<EffectInstance> | null = null;
	let instance: EffectInstance | null = null;
	let pending: Promise<unknown> = Promise.resolve();

	function initialize() {
		return initialization ??= createEffectInstance({
			effectSource: layer.effectSource, definitions: options.definitions, inputs: inputs.inputs, staticSettings,
			resolution: options.sceneBaseResolution, resolutionScale: options.resolutionScale, resolutionSetting: setting,
			usedOutputPorts: new Set([port]), resources: options.resources,
			tiling: options.tiling, onGpuTime: options.onGpuTime, onPreparationStatus: options.onPreparationStatus,
		}, options.wgpu, options.getNativeEffectImplementation, lifetime.signal).then(created => {
			if (lifetime.signal.aborted) {
				created.dispose();
				lifetime.signal.throwIfAborted();
			}
			instance = created;
			return created;
		});
	}

	async function render(context: TimelineLayerContext<TimelineImage>, request: AbortSignal) {
		if (request.aborted || lifetime.signal.aborted) return { gpuTime: 0 };
		const signal = AbortSignal.any([request, lifetime.signal]);
		const effect = await initialize();
		signal.throwIfAborted();
		options.applyPendingEffectValues?.(effect);
		const output = effect.outputs.get(port);
		// 出力が未接続のときは下層の画像を維持するため、Replaceでも合成をスキップする。
		if (output == null) return { gpuTime: 0 };
		const scope = createTimelineLayerEvaluationScope({ time: context.sceneTimeMs, isExport: context.isExport, publicParameters: context.publicParameters, automationGraphs: layer.automationGraphs });
		Object.assign(scope.variables, variables);
		await inputs.update(context, scope, signal);
		signal.throwIfAborted();
		// キー・式はScene時刻で評価し、Effect固有のアニメーションにはクリップの内容時刻（秒）を渡す。
		const frame: EffectFrameContext = {
			time: context.contentTimeMs / 1000, endTime: context.contentEndTimeMs / 1000, timeDelta: context.timeDelta,
			progress: context.clipElapsedTimeMs / context.clipDurationMs, isExport: context.isExport,
		};
		// 各ノードのタイル要否とコマンドの送信はEffect側の計画に従う。直接出力だけのGraphはGPUパスを作らない。
		await effect.renderTiled(frame, signal, context.isExport || options.tiling == null || options.tiling.mode === 'disabled' ? undefined : options.onTilingProgress);
		signal.throwIfAborted();
		const settings = compositing.evaluate({
			time: context.sceneTimeMs, isExport: context.isExport, coordinateSpace: layer.coordinateSpace, mask: layer.mask,
			layerMask: layer.layerMask, transformTarget: layer.transformTarget, paramValues: layer.compositingParamValues,
			publicParameters: context.publicParameters, automationGraphs: layer.automationGraphs,
		});
		return compositor.evaluate(context, { kind: 'texture', texture: output.texture }, settings);
	}

	return {
		evaluate(context, signal) {
			// 入力のスナップショットと履歴は一つのクリップ配置が所有する。中断中の非同期準備と次のサンプルを重ねない。
			const next = pending.then(() => render(context, signal)).catch(error => {
				if (signal.aborted || lifetime.signal.aborted) return { gpuTime: 0 };
				throw error;
			});
			pending = next.catch(() => {});
			return next;
		},
		resetRenderHistory() { if (instance?.dependsOnRenderHistory === true) instance.resetRenderHistory(); },
		destroy() {
			lifetime.abort();
			instance?.dispose();
			inputs.dispose();
			compositor.dispose();
		},
	};
}
