import EventEmitter from 'eventemitter3';
import { AssetTextures } from './asset-textures.ts';
import defaultVertexShaderCode from './vertex.wgsl?raw';
import { VisualModuleRenderer } from './visual-module-renderer.ts';
import { TimelineRenderer } from './timeline-renderer.ts';
import { createVisualModuleTimelineLayer } from './visual-module-timeline-layer.ts';
import { createTimelineCompositor } from './timeline-compositor.ts';
import { TimelineCompositingParameters } from './timeline-compositing-parameters.ts';
import { OutputTextureResolver } from './node-output.ts';
import { CanvasRenderer } from './canvas-renderer.ts';
import type { VisualModule } from '@glitch/shared/visual-module/types.ts';
import type { NodeOutput } from './node-output.ts';
import type { FrameScheduler } from './live-render-loop.ts';
import type { TimelineLayerRenderer } from './timeline-renderer.ts';
import type { EffectInstanceState, EffectStatusSource } from '@glitch/shared/effect/effect-status.ts';
import type { Asset, IntermediateTextureFormat } from '@glitch/shared/types.ts';
import type { Timeline, TimelineVisualModuleLayer } from '@glitch/shared/timeline/types.ts';
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
	resolution: {
		width: number;
		height: number;
	};
	/** 最終出力の黒つぶれを緑、白飛びをマゼンタで表示する。 */
	highlightClipping: boolean;
	/** 透過非対応の出力用に、乗算済みRGBを黒背景へ合成する。 */
	opaqueOutput: boolean;
	assets: Asset[];
	visualModules: VisualModule[];
	timeline: Timeline;
};

export type TimelineRendererManagerEvents = {
	'effectState': (ctx: { source: EffectStatusSource; nodeId: string; status: EffectInstanceState | null }) => void;
	'renderError': (ctx: { message: string | null }) => void;
};

export class TimelineRendererManager extends EventEmitter<{
	'ev': (ctx: { type: keyof TimelineRendererManagerEvents; ctx: Parameters<TimelineRendererManagerEvents[keyof TimelineRendererManagerEvents]>[0] }) => void;
}> {
	private timelineRenderer: TimelineRenderer<NodeOutput, Timeline[number]>;
	private previewRenderGeneration = 0;
	private nextTimelineLayerStatusId = 0;
	private gpuContext: GPUCanvasContext;
	private gpuDevice: GPUDevice;
	private canvasRenderer: CanvasRenderer;
	private defaultVertexShaderModule: GPUShaderModule;
	private fallbackTexture: GPUTexture;
	private outputTextures: OutputTextureResolver;
	private assetTextures: AssetTextures;
	private effectDefinitions: Record<string, EffectDefinition<any>>;
	private effectImplementations: Record<string, EffectImplementation<any>>;

	private readonly staticOptions: TimelineRendererManagerStaticOptions;
	private dynamicOptions: TimelineRendererManagerDynamicOptions = {
		resolution: { width: 1, height: 1 },
		highlightClipping: false,
		opaqueOutput: false,
		assets: [],
		visualModules: [],
		timeline: [],
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
		this.outputTextures = new OutputTextureResolver(this.gpuDevice, this.staticOptions.enable32bitDataTextures);
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

		this.timelineRenderer = new TimelineRenderer<NodeOutput, Timeline[number]>({
			fallbackOutput: { kind: 'texture', texture: this.fallbackTexture },
			createLayer: entry => this.createTimelineLayer(entry),
			present: (output, gpuTime) => {
				const commandEncoder = this.gpuDevice.createCommandEncoder();
				const tex = this.outputTextures.resolve(output);
				this.canvasRenderer.renderToCanvas(tex, commandEncoder);
				this.gpuDevice.queue.submit([commandEncoder.finish()]);
			},
			onClear: () => {
				this.canvasRenderer.clear();
			},
		});
	}

	private clearTimelineRenderers() {
		this.previewRenderGeneration++;
		this.timelineRenderer.clear();
	}

	// (非workerで)呼び出すときは値を独立した参照にすること！ パフォーマンス上の理由でこちら側ではdeepCloneしません
	public async updateDynamicOptions(newOptions: Partial<TimelineRendererManagerDynamicOptions>) {
		const { assets, ...synchronousOptions } = newOptions;
		// 通常の設定は呼び出し順に反映する。画像のデコード完了を待ってから反映すると、
		// 後から届いたモジュール編集やFPS変更を古い更新で巻き戻してしまう。
		// Asset一覧だけはテクスチャと同時に切り替えるため、ここではマージしない。
		this.dynamicOptions = { ...this.dynamicOptions, ...synchronousOptions };

		if (newOptions.resolution !== undefined || newOptions.visualModules !== undefined || newOptions.timeline !== undefined) {
			this.clearTimelineRenderers();
		}
		if (newOptions.resolution !== undefined) {
			const canvas = this.gpuContext.canvas;
			if (canvas.width !== this.dynamicOptions.resolution.width) canvas.width = this.dynamicOptions.resolution.width;
			if (canvas.height !== this.dynamicOptions.resolution.height) canvas.height = this.dynamicOptions.resolution.height;
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
	public async renderTimelineAt(time: number): Promise<void> {
		const generation = this.previewRenderGeneration;
		try {
			if (!Number.isFinite(time)) throw new Error('Timeline time must be finite');
			await this.timelineRenderer.renderAt(time, this.dynamicOptions.timeline);
			// 中断されたシークの完了で、新しい描画のエラーを消さない。
			if (generation === this.previewRenderGeneration) this.emit('ev', { type: 'renderError', ctx: { message: null } });
		} catch (error) {
			if (generation === this.previewRenderGeneration) this.emit('ev', { type: 'renderError', ctx: { message: error instanceof Error ? error.message : String(error) } });
		}
	}

	/** 専用インスタンスで順番に呼び、フレーム間の履歴と一定の経過時間を保持する。 */
	public async renderTimelineFrame(time: number, timeDelta: number): Promise<void> {
		await this.timelineRenderer.renderAt(time, this.dynamicOptions.timeline, timeDelta, true);
	}

	private createTimelineLayer(layer: Timeline[number]): TimelineLayerRenderer<NodeOutput> | undefined {
		// レイヤーの種類の解釈とリソース解決は、タイムライン制御の外側で行う。
		switch (layer.layerType) {
			case 'visualModule': {
				const visualModule = this.dynamicOptions.visualModules.find(module => module.id === layer.visualModuleId);
				if (visualModule == null) return;
				return this.createVisualModuleLayer(visualModule, layer);
			}
		}
	}

	private createVisualModuleLayer(visualModule: VisualModule, layer: TimelineVisualModuleLayer): TimelineLayerRenderer<NodeOutput> {
		const statusSource: EffectStatusSource = {
			type: 'timelineLayer',
			instanceId: `timeline:${this.nextTimelineLayerStatusId++}`,
			visualModuleId: visualModule.id,
			layerId: layer.id,
		};
		const renderer = new VisualModuleRenderer({
			gpuDevice: this.gpuDevice,
			gpuContext: this.gpuContext,
			fallbackTexture: this.fallbackTexture,
			resolution: this.dynamicOptions.resolution,
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
			resolution: this.dynamicOptions.resolution, format: this.staticOptions.intermediateTextureFormat,
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
							time: context.time,
							endTime: context.endTime,
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
		this.outputTextures.dispose();
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

	const context = options.canvas.getContext('webgpu');
	const histogramContext = options.histogramCanvas.getContext('webgpu');
	const waveformHorizontalContext = options.waveformHorizontalCanvas.getContext('webgpu');
	const waveformVerticalContext = options.waveformVerticalCanvas.getContext('webgpu');
	if (!(context instanceof GPUCanvasContext) || !(histogramContext instanceof GPUCanvasContext) || !(waveformHorizontalContext instanceof GPUCanvasContext) || !(waveformVerticalContext instanceof GPUCanvasContext)) {
		throw new Error('cannot get webgpu context');
	}

	const manager = new TimelineRendererManager({
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
}
