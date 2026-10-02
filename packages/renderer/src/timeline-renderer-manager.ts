import { scaleResolution, type Resolution } from '@glitch/shared/resolution.ts';
import { getTimelineScene, validateTimelineScenes } from '@glitch/shared/timeline/scenes.ts';
import { validateTimelineEffectLayer } from '@glitch/shared/timeline/effect-layer.ts';
import { getSceneBaseResolution, resolveSceneResolution } from '@glitch/shared/timeline/scene-resolution.ts';
import EventEmitter from 'eventemitter3';
import { AssetTextures } from './asset-textures.ts';
import defaultVertexShaderCode from './vertex.wgsl?raw';
import { VisualModuleRenderer } from './visual-module-renderer.ts';
import { TimelinePreviewScheduler } from './timeline-preview-scheduler.ts';
import { TimelineRenderer } from './timeline-renderer.ts';
import { createVisualModuleTimelineLayer } from './visual-module-timeline-layer.ts';
import { createSceneTimelineLayer } from './scene-timeline-layer.ts';
import { createVideoTimelineLayer } from './video-timeline-layer.ts';
import { createImageTimelineLayer } from './image-timeline-layer.ts';
import { createEffectTimelineLayer } from './effect-timeline-layer.ts';
import { createTimelineCompositor } from './timeline-compositor.ts';
import { TimelineCompositingParameters } from './timeline-compositing-parameters.ts';
import { createSceneOutput } from './scene-output.ts';
import { CanvasRenderer } from './canvas-renderer.ts';
import type { ProjectVisualModule } from '@glitch/shared/project/types.ts';
import type { NodeOutput } from './node-output.ts';
import type { FrameScheduler } from './live-render-loop.ts';
import type { TimelineLayerRenderer } from './timeline-renderer.ts';
import type { EffectInstanceState, EffectStatusSource } from '@glitch/shared/effect/effect-status.ts';
import type { Asset, IntermediateTextureFormat } from '@glitch/shared/types.ts';
import type { TimelineScene, TimelineLayer, TimelineVisualModuleLayer, TimelineInlineVisualModuleLayer } from '@glitch/shared/timeline/types.ts';
import type { VisualModule } from '@glitch/shared/visual-module/types.ts';
import type { EffectImplementation } from '@glitch/shared/effect/effect-implementation.js';
import type { EffectDefinition } from '@glitch/shared/effect/effect-definition.js';

/**
 * 初期化時に決まっている必要がある設定情報
 */
export type TimelineRendererManagerStaticOptions = {
	enable32bitDataTextures: boolean;
	/** 画像の中間テクスチャ形式。Canvas・データ用テクスチャには適用しない。 */
	intermediateTextureFormat: IntermediateTextureFormat;
};

/**
 * 初期化後に変更可能な設定情報
 */
export type TimelineRendererManagerDynamicOptions = {
	resolution: Resolution;
	/** 各Scene・素材・ノードの基準寸法に一度だけ適用する描画倍率。 */
	resolutionScale: number;
	/** エンコード用の最終寸法。Scene内部の解像度には影響させない。 */
	outputResolution: Resolution | null;
	/** 最終出力の黒つぶれを緑、白飛びをマゼンタで表示する。 */
	highlightClipping: boolean;
	/** 透過非対応の出力用に、乗算済みRGBを黒背景へ合成する。 */
	opaqueOutput: boolean;
	assets: Asset[];
	visualModules: ProjectVisualModule[];
	timelineScenes: TimelineScene[];
	sceneId: string | null;
};

export type TimelineRendererManagerEvents = {
	'effectState': (ctx: { source: EffectStatusSource; nodeId: string; status: EffectInstanceState | null }) => void;
	'renderError': (ctx: { message: string | null }) => void;
};

export class TimelineRendererManager extends EventEmitter<{
	'ev': (ctx: { [K in keyof TimelineRendererManagerEvents]: { type: K; ctx: Parameters<TimelineRendererManagerEvents[K]>[0] } }[keyof TimelineRendererManagerEvents]) => void;
}> {
	private timelineRenderer: TimelineRenderer<NodeOutput, TimelineLayer>;
	private previewRenderGeneration = 0;
	private nextTimelineLayerStatusId = 0;
	private previewScheduler = new TimelinePreviewScheduler(time => this.renderPreviewFrame(time));
	private gpuContext: GPUCanvasContext;
	private gpuDevice: GPUDevice;
	private canvasRenderer: CanvasRenderer;
	private defaultVertexShaderModule: GPUShaderModule;
	private fallbackTexture: GPUTexture;
	private sceneOutput: ReturnType<typeof createSceneOutput> | undefined;
	private assetTextures: AssetTextures;
	private effectDefinitions: Record<string, EffectDefinition<any>>;
	private effectImplementations: Record<string, EffectImplementation<any>>;
	private currentRenderError: string | null = null;

	private readonly staticOptions: TimelineRendererManagerStaticOptions;
	private dynamicOptions: TimelineRendererManagerDynamicOptions = {
		resolution: { width: 1, height: 1 },
		resolutionScale: 1,
		outputResolution: null,
		highlightClipping: false,
		opaqueOutput: false,
		assets: [],
		visualModules: [],
		timelineScenes: [],
		sceneId: null,
	};

	constructor(coreConfig: {
		gpuDevice: GPUDevice;
		gpuContext: GPUCanvasContext;
		frameScheduler?: FrameScheduler;
		histogramGpuContext?: GPUCanvasContext;
		waveformHorizontalGpuContext?: GPUCanvasContext;
		waveformVerticalGpuContext?: GPUCanvasContext;
		effectDefinitions: Record<string, EffectDefinition<any>>;
		effectImplementations: Record<string, EffectImplementation<any>>;
	}, staticOptions: TimelineRendererManagerStaticOptions) {
		super();

		this.staticOptions = { ...staticOptions };

		this.gpuDevice = coreConfig.gpuDevice;
		this.assetTextures = new AssetTextures(this.gpuDevice);
		this.gpuContext = coreConfig.gpuContext;
		this.effectDefinitions = coreConfig.effectDefinitions;
		this.effectImplementations = coreConfig.effectImplementations;

		this.gpuContext.configure({
			device: this.gpuDevice,
			format: navigator.gpu.getPreferredCanvasFormat(),
			alphaMode: 'premultiplied',
			colorSpace: 'srgb',
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});

		this.fallbackTexture = this.gpuDevice.createTexture({
			size: [1, 1],
			format: this.staticOptions.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING,
		});

		this.defaultVertexShaderModule = this.gpuDevice.createShaderModule({
			code: defaultVertexShaderCode,
		});

		this.canvasRenderer = new CanvasRenderer({
			gpuDevice: this.gpuDevice,
			gpuContext: this.gpuContext,
			histogramGpuContext: coreConfig.histogramGpuContext,
			waveformHorizontalGpuContext: coreConfig.waveformHorizontalGpuContext,
			waveformVerticalGpuContext: coreConfig.waveformVerticalGpuContext,
		});

		this.timelineRenderer = new TimelineRenderer<NodeOutput, TimelineLayer>({
			fallbackOutput: { kind: 'uniform', value: [0, 0, 0, 0] },
			createLayer: (entry, clipId) => this.createTimelineLayer(entry, clipId, [entry.id], this.sceneBaseResolution),
			present: (output, gpuTime) => {
				const commandEncoder = this.gpuDevice.createCommandEncoder();
				this.sceneOutput ??= createSceneOutput({ device: this.gpuDevice, vertex: this.defaultVertexShaderModule,
					resolution: this.renderResolution, format: this.staticOptions.intermediateTextureFormat });
				const tex = this.sceneOutput.render(commandEncoder, output);
				this.canvasRenderer.renderToCanvas(tex, commandEncoder);
				this.gpuDevice.queue.submit([commandEncoder.finish()]);
			},
			onClear: () => {
				this.canvasRenderer.clear();
			},
		});
	}

	// 毎フレーム通知を発生させないように前回から変わっている場合のみ通知
	private setRenderError(message: string | null) {
		if (this.currentRenderError === message) return;
		this.currentRenderError = message;
		this.emit('ev', { type: 'renderError', ctx: { message } });
	}

	private clearTimelineRenderers() {
		this.previewScheduler.clear();
		this.previewRenderGeneration++;
		this.timelineRenderer.clear();
		this.sceneOutput?.dispose();
		this.sceneOutput = undefined;
	}

	// (非workerで)呼び出すときは値を独立した参照にすること！ パフォーマンス上の理由でこちら側ではdeepCloneしません
	public async updateDynamicOptions(newOptions: Partial<TimelineRendererManagerDynamicOptions>) {
		if (newOptions.timelineScenes != null) {
			validateTimelineScenes(newOptions.timelineScenes);
			for (const scene of newOptions.timelineScenes) for (const layer of scene.layers) {
				if (layer.layerType === 'effect') validateTimelineEffectLayer(layer, this.effectDefinitions[layer.effectId]);
			}
		}
		const { assets, ...synchronousOptions } = newOptions;
		// 通常の設定は呼び出し順に反映する。画像のデコード完了を待ってから反映すると、
		// 後から届いたモジュール編集やFPS変更を古い更新で巻き戻してしまう。
		// Asset一覧だけはテクスチャと同時に切り替えるため、ここではマージしない。
		this.dynamicOptions = { ...this.dynamicOptions, ...synchronousOptions };
		this.canvasRenderer.highlightClipping = this.dynamicOptions.highlightClipping;
		this.canvasRenderer.opaqueOutput = this.dynamicOptions.opaqueOutput;

		if (newOptions.resolution !== undefined || newOptions.resolutionScale !== undefined || newOptions.visualModules !== undefined || newOptions.timelineScenes !== undefined || newOptions.sceneId !== undefined) {
			this.clearTimelineRenderers();
		}
		if (newOptions.resolution !== undefined || newOptions.resolutionScale !== undefined || newOptions.timelineScenes !== undefined || newOptions.sceneId !== undefined || newOptions.outputResolution !== undefined) {
			try {
				// 出力寸法を上書きする書き出しでも、Scene内部の寸法を先に検証する。
				const sceneResolution = this.renderResolution;
				const resolution = this.dynamicOptions.outputResolution ?? sceneResolution;
				if (![resolution.width, resolution.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= this.gpuDevice.limits.maxTextureDimension2D)) {
					throw new Error(`Invalid output resolution: ${resolution.width} × ${resolution.height}`);
				}
				const canvas = this.gpuContext.canvas;
				if (canvas.width !== resolution.width) canvas.width = resolution.width;
				if (canvas.height !== resolution.height) canvas.height = resolution.height;
			} catch (error) {
				this.setRenderError(error instanceof Error ? error.message : String(error));
				throw error;
			}
		}

		const assetsCommitted = assets === undefined ? null : await this.updateAssets(assets);
		return { assetsCommitted };
	}

	private updateAssets(assets: Asset[]): Promise<boolean> {
		return this.assetTextures.update(assets, () => {
			// 世代管理で採用された更新だけが一覧とキャッシュを切り替える。
			// 中断されたデコードの完了後に、Asset一覧だけを上書きしてはいけない。
			this.clearTimelineRenderers();
			this.dynamicOptions.assets = assets;
		});
	}

	/** timeはミリ秒。表示期間中はレイヤーごとのインスタンスと履歴を保持する。 */
	public renderTimelineAt(time: number, playback = false): Promise<void> {
		return this.previewScheduler.render(time, playback);
	}

	private async renderPreviewFrame(time: number): Promise<boolean> {
		const generation = ++this.previewRenderGeneration;
		try {
			if (!Number.isFinite(time)) throw new Error('Timeline time must be finite');
			await this.timelineRenderer.renderAt(time, this.getSceneLayers());
			// 中断されたシークの完了で、新しい描画のエラーを消さない。
			if (generation === this.previewRenderGeneration) this.setRenderError(null);
			return true;
		} catch (error) {
			if (generation === this.previewRenderGeneration) this.setRenderError(error instanceof Error ? error.message : String(error));
			return false;
		}
	}

	/** 専用インスタンスで順番に呼び、フレーム間の履歴と一定の経過時間を保持する。 */
	public async renderTimelineFrame(time: number, timeDelta: number): Promise<void> {
		await this.timelineRenderer.renderAt(time, this.getSceneLayers(), timeDelta, true);
	}

	private get renderResolution(): Resolution {
		return resolveSceneResolution(this.dynamicOptions.sceneId == null ? { mode: 'project' }
			: getTimelineScene(this.dynamicOptions.timelineScenes, this.dynamicOptions.sceneId).resolution,
		this.dynamicOptions.resolution, this.dynamicOptions.resolutionScale, this.gpuDevice.limits.maxTextureDimension2D);
	}

	private get sceneBaseResolution(): Resolution {
		return this.dynamicOptions.sceneId == null ? this.dynamicOptions.resolution
			: getSceneBaseResolution(getTimelineScene(this.dynamicOptions.timelineScenes, this.dynamicOptions.sceneId).resolution, this.dynamicOptions.resolution);
	}

	private getSceneLayers() {
		return this.dynamicOptions.sceneId == null ? [] : getTimelineScene(this.dynamicOptions.timelineScenes, this.dynamicOptions.sceneId).layers.filter(layer => layer.layerType !== 'audio');
	}

	private createTimelineLayer(layer: TimelineLayer, clipId: string, layerPath: string[], sceneBaseResolution: Resolution): TimelineLayerRenderer<NodeOutput> {
		const renderResolution = scaleResolution(sceneBaseResolution, this.dynamicOptions.resolutionScale);
		// レイヤーの種類の解釈とリソース解決は、タイムライン制御の外側で行う。
		switch (layer.layerType) {
			case 'effect': {
				const definition = this.effectDefinitions[layer.effectId];
				const implementation = this.effectImplementations[layer.effectId];
				if (!definition || !implementation) throw new Error(`Effect not found: ${layer.effectId}`);
				return createEffectTimelineLayer(layer, definition, implementation, {
					wgpu: { device: this.gpuDevice, defaultVertexShaderModule: this.defaultVertexShaderModule,
						enable32bitDataTextures: this.staticOptions.enable32bitDataTextures, intermediateTextureFormat: this.staticOptions.intermediateTextureFormat },
					fallbackTexture: this.fallbackTexture, resolution: renderResolution, resolutionScale: this.dynamicOptions.resolutionScale,
					assets: this.dynamicOptions.assets, assetTextures: this.assetTextures.textures,
				});
			}
			case 'image': {
				const clip = layer.clips.find(clip => clip.id === clipId)!;
				const texture = this.assetTextures.textures.get(clip.assetId);
				// 参照切れを透明画像として合成すると、replaceで下層まで消してしまう。
				// IDは保存したままエラーにし、Asset削除のUndoや参照画像の変更で復旧できるようにする。
				if (!texture) throw new Error(`Image asset not found: ${clip.assetId}`);
				return createImageTimelineLayer(layer, texture, {
					device: this.gpuDevice, vertex: this.defaultVertexShaderModule,
					resolution: renderResolution, format: this.staticOptions.intermediateTextureFormat,
					resolutionScale: this.dynamicOptions.resolutionScale,
				});
			}
			case 'video': {
				const clip = layer.clips.find(clip => clip.id === clipId)!;
				const asset = this.dynamicOptions.assets.find(asset => asset.id === clip.assetId);
				if (!asset) throw new Error(`Video asset not found: ${clip.assetId}`);
				return createVideoTimelineLayer(layer, asset.fileData, {
					device: this.gpuDevice, vertex: this.defaultVertexShaderModule,
					resolution: renderResolution, format: this.staticOptions.intermediateTextureFormat,
					resolutionScale: this.dynamicOptions.resolutionScale,
				});
			}
			case 'scene': {
				const clip = layer.clips.find(clip => clip.id === clipId)!;
				const scene = getTimelineScene(this.dynamicOptions.timelineScenes, clip.sceneId);
				const childBaseResolution = getSceneBaseResolution(scene.resolution, this.dynamicOptions.resolution);
				return createSceneTimelineLayer(scene, layer, {
					device: this.gpuDevice,
					vertex: this.defaultVertexShaderModule,
					resolution: renderResolution,
					sceneResolution: resolveSceneResolution(scene.resolution, this.dynamicOptions.resolution,
						this.dynamicOptions.resolutionScale, this.gpuDevice.limits.maxTextureDimension2D),
					format: this.staticOptions.intermediateTextureFormat,
					createLayer: (entry, childClipId) => this.createTimelineLayer(entry, childClipId, [...layerPath, clipId, entry.id], childBaseResolution),
				});
			}
			case 'visualModule': {
				const visualModule = this.dynamicOptions.visualModules.find(module => module.id === layer.visualModuleId);
				if (visualModule == null) throw new Error(`Visual module not found: ${layer.visualModuleId}`);
				return this.createVisualModuleLayer(visualModule, layer, layerPath, sceneBaseResolution);
			}
			case 'inlineVisualModule':
				return this.createVisualModuleLayer(layer.visualModule, layer, layerPath, sceneBaseResolution);
		}
		throw new Error(`Unrecognized layer type: ${layer.layerType}`);
	}

	private createVisualModuleLayer(visualModule: VisualModule, layer: TimelineVisualModuleLayer | TimelineInlineVisualModuleLayer, layerPath: string[], sceneBaseResolution: Resolution): TimelineLayerRenderer<NodeOutput> {
		const statusSource: EffectStatusSource = {
			type: 'timelineLayer',
			instanceId: `timeline:${this.nextTimelineLayerStatusId++}`,
			layerId: layer.id,
			rootSceneId: this.dynamicOptions.sceneId!,
			layerPath,
		};
		const renderer = new VisualModuleRenderer({
			gpuDevice: this.gpuDevice,
			fallbackTexture: this.fallbackTexture,
			resolution: sceneBaseResolution,
			resolutionScale: this.dynamicOptions.resolutionScale,
			enable32bitDataTextures: this.staticOptions.enable32bitDataTextures,
			intermediateTextureFormat: this.staticOptions.intermediateTextureFormat,
			enableStats: false,
			timingHelper: null,
			onEffectState: (nodeId, status) => this.emit('ev', { type: 'effectState', ctx: { source: statusSource, nodeId, status } }),
			videoFrames: new Map(),
			videoFrameVersions: new Map(),
			assets: this.dynamicOptions.assets,
			visualModule,
			assetTextures: this.assetTextures.textures,
			audioSources: new Map(),
			effectDefinitions: this.effectDefinitions,
			effectImplementations: this.effectImplementations,
		});
		const compositingParameters = new TimelineCompositingParameters();
		const compositor = createTimelineCompositor({
			device: this.gpuDevice, vertex: this.defaultVertexShaderModule,
			resolution: scaleResolution(sceneBaseResolution, this.dynamicOptions.resolutionScale), format: this.staticOptions.intermediateTextureFormat,
			beginPass: (encoder, descriptor) => encoder.beginRenderPass(descriptor),
		});
		return createVisualModuleTimelineLayer(visualModule, layer, {
			prepare: (context, signal) => renderer.prepare(context, signal),
			render: async (context, layerContext) => {
				const commandEncoder = this.gpuDevice.createCommandEncoder();
				let output: NodeOutput | undefined;
				const gpuTime = 0;
				try {
					output = renderer.render(context, commandEncoder);
					if (output != null) {
						const settings = compositingParameters.evaluate({
							time: layerContext.sceneTimeMs,
							isExport: context.isExport,
							paramValues: layer.compositingParamValues,
							automationGraphs: layer.automationGraphs,
						});
						output = compositor.render(commandEncoder, layerContext.input, output, settings);
					}
				} finally {
					// 描画途中の例外でもエンコーダーと計測を完了する。
					this.gpuDevice.queue.submit([commandEncoder.finish()]);
				}
				return { output, gpuTime };
			},
			destroy: () => {
				compositor.dispose();
				renderer.destroy();
			},
		});
	}

	public destroy() {
		this.clearTimelineRenderers();
		this.assetTextures.dispose();
		this.canvasRenderer.destroy();
		this.gpuDevice?.destroy();
	}
}

export async function createManager(options: {
	canvas: OffscreenCanvas;
	histogramCanvas: OffscreenCanvas;
	waveformHorizontalCanvas: OffscreenCanvas;
	waveformVerticalCanvas: OffscreenCanvas;
	staticOptions: TimelineRendererManagerStaticOptions;
	dynamicOptions: Partial<TimelineRendererManagerDynamicOptions>;
	effectDefinitions: Record<string, EffectDefinition>;
	effectImplementations: Record<string, EffectImplementation>;
}) {
	const adapter = await navigator.gpu?.requestAdapter({
		powerPreference: 'high-performance',
	});

	const device = await adapter?.requestDevice({
		requiredFeatures: [
			...(options.staticOptions.enable32bitDataTextures ? ['float32-filterable'] as const : []),
		],
	});
	if (device == null) {
		throw new Error('need a browser that supports WebGPU');
	}

	let manager: TimelineRendererManager | undefined;
	try {
		const context = options.canvas.getContext('webgpu');
		const histogramContext = options.histogramCanvas.getContext('webgpu');
		const waveformHorizontalContext = options.waveformHorizontalCanvas.getContext('webgpu');
		const waveformVerticalContext = options.waveformVerticalCanvas.getContext('webgpu');
		if (!(context instanceof GPUCanvasContext) || !(histogramContext instanceof GPUCanvasContext) || !(waveformHorizontalContext instanceof GPUCanvasContext) || !(waveformVerticalContext instanceof GPUCanvasContext)) {
			throw new Error('cannot get webgpu context');
		}

		manager = new TimelineRendererManager({
			gpuDevice: device,
			gpuContext: context,
			histogramGpuContext: histogramContext,
			waveformHorizontalGpuContext: waveformHorizontalContext,
			waveformVerticalGpuContext: waveformVerticalContext,
			effectDefinitions: options.effectDefinitions,
			effectImplementations: options.effectImplementations,
		}, options.staticOptions);

		await manager.updateDynamicOptions(options.dynamicOptions);

		return manager;
	} catch (error) {
		// 呼び出し元にはまだmanagerを返していないため、ここでリソースを回収する。
		if (manager != null) manager.destroy();
		else device.destroy();
		throw error;
	}
}
