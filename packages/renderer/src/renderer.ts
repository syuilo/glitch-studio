import { createTextureFromSource, makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { AudioHistory } from '@glitch/shared/audio-history.ts';
import { float32ToFloat16Bits } from '@glitch/shared/utility/float32ToFloat16Bits.ts';
import defaultVertexShaderCode from './vertex.wgsl?raw';
import TimingHelper from './utility/TimingHelper.ts';
import finalRenderShaderCode from './render.wgsl?raw';
import { NonNegativeRollingAverage } from './utility/NonNegativeRollingAverage.ts';
import { GpuHistogram } from './utility/histogram/GpuHistogram.ts';
import { GpuWaveform } from './utility/waveform/GpuWaveform.ts';
import { GpuMemoryTracker } from './utility/GpuMemoryTracker.ts';
import { VisualModuleRenderer } from './visual-module-renderer.ts';
import { LiveRenderLoop, browserFrameScheduler } from './live-render-loop.ts';
import { TimelineRenderer } from './timeline-renderer.ts';
import { createVisualModuleTimelineLayer } from './visual-module-timeline-layer.ts';
import type { FrameScheduler, LiveFrameTiming } from './live-render-loop.ts';
import type { TimelineLayerRenderer } from './timeline-renderer.ts';
import type { EffectStatus } from '@glitch/shared/effect-status.ts';
import type { AudioCaptureMessage, AudioSourceId } from '@glitch/shared/audio.ts';
import type { Asset, GsAutomation, Player, Timeline, VisualModule, VisualModuleLayer, VisualModuleParamValues } from '@glitch/shared/types.ts';
import type { EffectImplementation, IntermediateTextureFormat } from '@glitch/shared/effect-implementation.js';
import type { EffectDefinition } from '@glitch/shared/effect-definition.js';

export class MainRenderer {
	private timelineRenderer: TimelineRenderer<GPUTexture, Timeline[number]>;
	private onEffectStatus?: (nodeId: string, status: EffectStatus | null) => void;
	private gpuContext: GPUCanvasContext;
	private gpuDevice: GPUDevice;
	private resolution: { width: number; height: number; };
	private defaultVertexShaderModule: GPUShaderModule;
	private fallbackTexture: GPUTexture;
	private fallbackScalarFieldTexture: GPUTexture;
	private enableStats = true;
	private highlightClipping = false;
	private frameScheduler: FrameScheduler;
	private liveRenderLoop: LiveRenderLoop;
	private liveVisualModuleId: VisualModule['id'] | null = null;
	private liveParamValues: VisualModuleParamValues = {};
	private liveVisualModuleRenderer: VisualModuleRenderer | null = null;
	private timeline: Timeline = [];
	private assets: Asset[] = [];
	private automations: GsAutomation[] = [];
	private visualModules: VisualModule[] = [];
	private assetTextures: Map<string, GPUTexture> = new Map();
	private videoFrames: Map<Player['id'], VideoFrame> = new Map();
	private videoFrameVersions: Map<Player['id'], number> = new Map();
	private audioSources = new Map<AudioSourceId, AudioHistory>();
	private audioPorts = new Map<AudioSourceId, MessagePort>();
	private timingHelper: TimingHelper;
	private finalRenderSampler: GPUSampler;
	private finalRenderPipeline: GPURenderPipeline;
	private finalRenderUniformValues: ReturnType<typeof makeStructuredView>;
	private finalRenderUniformBuffer: GPUBuffer;
	private finalRenderBindGroup: GPUBindGroup | null = null;
	private latestRenderedToCanasTexture: GPUTexture | null = null;
	private enable32bitDataTextures = false;
	private readonly intermediateTextureFormat: IntermediateTextureFormat;
	private pointerPosition: { x: number; y: number } = { x: -99999, y: -99999 };
	private pointerPositionPrev: { x: number; y: number } = { x: -99999, y: -99999 };
	private lastPointerUpdateTimestamp = 0;
	private histogramGpuContext: GPUCanvasContext;
	private waveformHorizontalGpuContext: GPUCanvasContext;
	private gpuHistogram: GpuHistogram;
	private gpuWaveformHorizontal: GpuWaveform;
	private gpuWaveformVertical: GpuWaveform;
	private effectDefinitions: Record<string, EffectDefinition<any>>;
	private effectImplementations: Record<string, EffectImplementation<any>>;
	public gpuAverageFast = new NonNegativeRollingAverage(10);
	public gpuAverageMedium = new NonNegativeRollingAverage(100);
	public gpuAverageSlow = new NonNegativeRollingAverage(1000);
	public fpsAverage = new NonNegativeRollingAverage(30);
	public readonly gpuMemory: GpuMemoryTracker;

	constructor(options: {
		onEffectStatus?: (nodeId: string, status: EffectStatus | null) => void;
		gpuDevice: GPUDevice;
		gpuContext: GPUCanvasContext;
		resolution: {
			width: number;
			height: number;
		};
		enable32bitDataTextures: boolean;
		/** 画像の中間テクスチャ形式。省略時はrgba16float。Canvas・データ用テクスチャには適用しない。 */
		intermediateTextureFormat: IntermediateTextureFormat;
		enableStats: boolean;
		/** 最終出力の黒つぶれを緑、白飛びをマゼンタで表示する。 */
		highlightClipping?: boolean;
		liveTimeFactor?: number;
		fpsLimit: number | null;
		frameScheduler?: FrameScheduler;
		visualModules?: VisualModule[];
		timeline?: Timeline;
		assets: Asset[];
		automations: GsAutomation[];
		histogramGpuContext: GPUCanvasContext;
		waveformHorizontalGpuContext: GPUCanvasContext;
		waveformVerticalGpuContext: GPUCanvasContext;
		effectDefinitions: Record<string, EffectDefinition<any>>;
		effectImplementations: Record<string, EffectImplementation<any>>;
	}) {
		this.resolution = options.resolution;
		this.onEffectStatus = options.onEffectStatus;
		this.visualModules = options.visualModules ?? [];
		this.timeline = options.timeline ?? [];
		this.enableStats = options.enableStats;
		this.highlightClipping = options.highlightClipping ?? false;
		this.frameScheduler = options.frameScheduler ?? browserFrameScheduler;
		this.liveRenderLoop = new LiveRenderLoop({
			scheduler: this.frameScheduler,
			onFrame: timing => this.renderLiveFrame(timing),
			fpsLimit: options.fpsLimit,
			timeFactor: options.liveTimeFactor ?? 1,
		});
		this.enable32bitDataTextures = options.enable32bitDataTextures;
		this.intermediateTextureFormat = options.intermediateTextureFormat;
		this.gpuDevice = options.gpuDevice;
		this.gpuContext = options.gpuContext;
		this.histogramGpuContext = options.histogramGpuContext;
		this.effectDefinitions = options.effectDefinitions;
		this.effectImplementations = options.effectImplementations;

		this.gpuMemory = new GpuMemoryTracker(this.gpuDevice);

		this.gpuHistogram = new GpuHistogram(
			this.gpuDevice,
			this.histogramGpuContext,
			navigator.gpu.getPreferredCanvasFormat(),
		);
		this.waveformHorizontalGpuContext = options.waveformHorizontalGpuContext;
		this.gpuWaveformHorizontal = new GpuWaveform(
			this.gpuDevice,
			this.waveformHorizontalGpuContext,
			navigator.gpu.getPreferredCanvasFormat(),
		);

		this.gpuWaveformVertical = new GpuWaveform(
			this.gpuDevice,
			options.waveformVerticalGpuContext,
			navigator.gpu.getPreferredCanvasFormat(),
			'y',
		);

		this.timingHelper = new TimingHelper(this.gpuDevice);

		this.gpuContext.configure({
			device: this.gpuDevice,
			format: navigator.gpu.getPreferredCanvasFormat(),
			alphaMode: 'premultiplied',
			colorSpace: 'srgb',
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});

		this.fallbackTexture = this.gpuDevice.createTexture({
			size: [1, 1],
			format: this.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING,
		});

		this.fallbackScalarFieldTexture = this.gpuDevice.createTexture({
			size: [1, 1],
			format: this.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
		});

		const sclarPixelData = this.enable32bitDataTextures
			? new Float32Array([0])
			: new Uint16Array([float32ToFloat16Bits(0)]);

		this.gpuDevice.queue.writeTexture(
			{ texture: this.fallbackScalarFieldTexture },
			sclarPixelData,
			{ bytesPerRow: sclarPixelData.byteLength, rowsPerImage: 1 },
			{ width: 1, height: 1 },
		);

		this.defaultVertexShaderModule = this.gpuDevice.createShaderModule({
			code: defaultVertexShaderCode,
		});

		const finalRenderShaderModule = this.gpuDevice.createShaderModule({
			code: finalRenderShaderCode,
		});

		const finalRenderShaderDataDefinitions = makeShaderDataDefinitions(finalRenderShaderCode);

		this.finalRenderSampler = this.gpuDevice.createSampler({ minFilter: 'linear', magFilter: 'linear' });
		this.finalRenderPipeline = this.gpuDevice.createRenderPipeline({
			vertex: {
				module: this.defaultVertexShaderModule,
			},
			fragment: {
				module: finalRenderShaderModule,
				targets: [{
					format: navigator.gpu.getPreferredCanvasFormat(),
				}],
			},
			primitive: {
				topology: 'triangle-list',
			},
			layout: 'auto',
		});

		this.finalRenderUniformValues = makeStructuredView(finalRenderShaderDataDefinitions.uniforms.uniforms);

		this.finalRenderUniformBuffer = this.gpuDevice.createBuffer({
			size: this.finalRenderUniformValues.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		this.timelineRenderer = new TimelineRenderer<GPUTexture, Timeline[number]>({
			fallbackOutput: this.fallbackTexture,
			createLayer: entry => this.createTimelineLayer(entry),
			present: (texture, gpuTime) => {
				this.renderToCanvas(texture, this.gpuDevice.createCommandEncoder());
				if (this.enableStats) {
					this.gpuAverageFast.addSample(gpuTime / 1000);
					this.gpuAverageMedium.addSample(gpuTime / 1000);
					this.gpuAverageSlow.addSample(gpuTime / 1000);
				}
			},
			onClear: () => {
				this.finalRenderBindGroup = null;
				this.latestRenderedToCanasTexture = null;
			},
		});

		this.updateAssets(options.assets);

		this.updateAutomations(options.automations);
	}

	// (非workerで)呼び出すときはnewAssetsを独立した参照にすること！ パフォーマンス上の理由でこちら側ではdeepCloneしません
	public updateAssets(newAssets: Asset[]) {
		this.clearTimelineRenderers();
		this.assets = newAssets;
		for (const [k, v] of this.assetTextures.entries()) {
			v.destroy();
			this.assetTextures.delete(k);
		}

		for (const asset of this.assets) {
			if (asset.fileDataType.startsWith('image/') && asset.data != null) {
				const tex = createTextureFromSource(this.gpuDevice, {
					data: asset.data,
					width: asset.width,
					height: asset.height,
				});
				this.assetTextures.set(asset.id, tex);
			}
		}
		this.liveVisualModuleRenderer?.updateAssets();
	}

	// (非workerで)呼び出すときはnewAutomationsを独立した参照にすること！ パフォーマンス上の理由でこちら側ではdeepCloneしません
	public updateAutomations(newAutomations: GsAutomation[]) {
		this.clearTimelineRenderers();
		this.automations = newAutomations;
		this.liveVisualModuleRenderer?.updateAutomations(newAutomations);
	}

	public updateVisualModules(newVisualModules: VisualModule[]) {
		this.clearTimelineRenderers();
		this.visualModules = newVisualModules;
		if (this.liveVisualModuleRenderer != null) {
			const visualModule = this.visualModules.find(visualModule => visualModule.id === this.liveVisualModuleId);
			if (visualModule == null) this.stopRenderLoop();
			else this.liveVisualModuleRenderer.updateVisualModule(visualModule);
		}
	}

	public updateTimeline(newTimeline: Timeline) {
		this.clearTimelineRenderers();
		this.timeline = newTimeline;
	}

	private clearTimelineRenderers() {
		this.timelineRenderer.clear();
	}

	public attachAudioSource(id: AudioSourceId, port: MessagePort) {
		this.resetAudioSource(id, null);
		const history = new AudioHistory();
		this.audioSources.set(id, history);
		this.audioPorts.set(id, port);
		port.onmessage = (event: MessageEvent<AudioCaptureMessage>) => {
			if (this.audioPorts.get(id) !== port) return;
			const message = event.data;
			if (message.type === 'reset') {
				if (message.generation >= history.generation) history.reset(message.generation);
			} else if (message.type === 'samples') {
				try {
					if (message.frameCount === 1024 && message.buffer.byteLength === 8192
						&& (message.channelCount === 1 || message.channelCount === 2)
						&& Number.isFinite(message.sampleRate) && message.sampleRate >= 8000 && message.sampleRate <= 192000
						&& Number.isSafeInteger(message.startFrame) && message.startFrame >= 0) history.append(message);
				} finally {
					port.postMessage({ type: 'recycle', buffer: message.buffer }, [message.buffer]);
				}
			}
		};
	}

	public resetAudioSource(id: AudioSourceId, generation: number | null) {
		const history = this.audioSources.get(id);
		if (generation == null) {
			history?.reset();
			this.audioPorts.get(id)?.close();
			this.audioPorts.delete(id);
			this.audioSources.delete(id);
		} else if (history && generation >= history.generation) {
			history.reset(generation);
		}
	}

	public updateVideoFrame(playerId: Player['id'], videoFrame: VideoFrame | null) {
		// 同じtimestampでも別のフレームとして扱う。削除・再追加でも更新番号を戻さない。
		this.videoFrameVersions.set(playerId, (this.videoFrameVersions.get(playerId) ?? 0) + 1);
		this.videoFrames.get(playerId)?.close();
		if (videoFrame) {
			this.videoFrames.set(playerId, videoFrame);
		} else {
			this.videoFrames.delete(playerId);
		}
	}

	public updatePointerPosition(newPointerPosition: { x: number; y: number }) {
		this.pointerPosition = newPointerPosition;
		this.lastPointerUpdateTimestamp = this.frameScheduler.now();
	}

	public changeLiveModeFpsLimit(newFpsLimit: number | null) {
		this.liveRenderLoop.fpsLimit = newFpsLimit;
	}

	public setHighlightClipping(enabled: boolean) {
		this.highlightClipping = enabled;
	}

	public setLiveTimeFactor(value: number) {
		this.liveRenderLoop.timeFactor = value;
	}

	private renderToCanvas(tex: GPUTexture, commandEncoder: GPUCommandEncoder) {
		if (this.finalRenderBindGroup == null || this.latestRenderedToCanasTexture !== tex) {
			this.latestRenderedToCanasTexture = tex;
			this.finalRenderBindGroup = this.gpuDevice.createBindGroup({
				layout: this.finalRenderPipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 1, resource: { buffer: this.finalRenderUniformBuffer } },
					{ binding: 3, resource: this.finalRenderSampler },
					{ binding: 2, resource: tex.createView() }, // TODO: cache view
				],
			});
		}

		this.finalRenderUniformValues.set({
			highlightClipping: this.highlightClipping ? 1 : 0,
		});
		this.gpuDevice.queue.writeBuffer(this.finalRenderUniformBuffer, 0, this.finalRenderUniformValues.arrayBuffer);

		const passEncoder = commandEncoder.beginRenderPass({
			colorAttachments: [{
				view: this.gpuContext.getCurrentTexture().createView(),
				clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
				loadOp: 'clear',
				storeOp: 'store',
			}],
		});
		passEncoder.setPipeline(this.finalRenderPipeline);
		passEncoder.setBindGroup(0, this.finalRenderBindGroup);
		passEncoder.draw(6);
		passEncoder.end();

		this.gpuHistogram.render(commandEncoder, tex);
		this.gpuWaveformHorizontal.render(commandEncoder, tex);
		this.gpuWaveformVertical.render(commandEncoder, tex);

		this.gpuDevice.queue.submit([commandEncoder.finish()]);
	}

	/** timeはミリ秒。表示期間中はレイヤーごとのインスタンスと履歴を保持する。 */
	public async renderTimelineAt(time: number): Promise<void> {
		if (!Number.isFinite(time)) throw new Error('Timeline time must be finite');
		this.stopRenderLoop();
		await this.timelineRenderer.renderAt(time, this.timeline);
	}

	private createTimelineLayer(entry: Timeline[number]): TimelineLayerRenderer<GPUTexture> | undefined {
		// レイヤーの種類の解釈とリソース解決は、タイムライン制御の外側で行う。
		const layer = entry.layer;
		switch (layer.type) {
			case 'visualModule': {
				const visualModule = this.visualModules.find(module => module.id === layer.visualModuleId);
				if (visualModule == null) return;
				return this.createVisualModuleLayer(visualModule, layer);
			}
		}
	}

	private createVisualModuleLayer(visualModule: VisualModule, layer: VisualModuleLayer): TimelineLayerRenderer<GPUTexture> {
		const renderer = new VisualModuleRenderer({
			gpuDevice: this.gpuDevice,
			gpuContext: this.gpuContext,
			defaultVertexShaderModule: this.defaultVertexShaderModule,
			fallbackTexture: this.fallbackTexture,
			fallbackScalarFieldTexture: this.fallbackScalarFieldTexture,
			resolution: this.resolution,
			enable32bitDataTextures: this.enable32bitDataTextures,
			intermediateTextureFormat: this.intermediateTextureFormat,
			enableStats: this.enableStats,
			timingHelper: this.timingHelper,
			onEffectStatus: this.onEffectStatus,
			videoFrames: this.videoFrames,
			videoFrameVersions: this.videoFrameVersions,
			assets: this.assets,
			automations: this.automations,
			visualModule,
			assetTextures: this.assetTextures,
			audioSources: this.audioSources,
			effectDefinitions: this.effectDefinitions,
			effectImplementations: this.effectImplementations,
		});
		return createVisualModuleTimelineLayer(visualModule, layer, {
			prepare: (context, signal) => renderer.prepare(context, signal),
			render: async context => {
				const commandEncoder = this.gpuDevice.createCommandEncoder();
				let output: GPUTexture | undefined;
				let gpuTime = 0;
				try {
					output = renderer.render(context, commandEncoder);
				} finally {
					// 描画途中の例外でもエンコーダーと計測を完了する。
					this.gpuDevice.queue.submit([commandEncoder.finish()]);
					if (this.enableStats) gpuTime = await this.timingHelper.getResult();
				}
				return { output, gpuTime };
			},
			destroy: () => renderer.destroy(),
		});
	}

	public updateLiveParamValues(paramValues: VisualModuleParamValues) {
		this.liveParamValues = paramValues;
	}

	public startLiveRenderLoopFor(visualModuleId: string, paramValues: VisualModuleParamValues = {}) {
		this.clearTimelineRenderers();
		this.stopRenderLoop();

		const visualModule = this.visualModules.find(g => g.id === visualModuleId);
		if (visualModule == null) return;

		this.liveVisualModuleId = visualModuleId;
		this.liveParamValues = paramValues;
		this.liveVisualModuleRenderer = new VisualModuleRenderer({
			gpuDevice: this.gpuDevice,
			gpuContext: this.gpuContext,
			defaultVertexShaderModule: this.defaultVertexShaderModule,
			fallbackTexture: this.fallbackTexture,
			fallbackScalarFieldTexture: this.fallbackScalarFieldTexture,
			resolution: this.resolution,
			enable32bitDataTextures: this.enable32bitDataTextures,
			intermediateTextureFormat: this.intermediateTextureFormat,
			enableStats: this.enableStats,
			timingHelper: this.timingHelper,
			onEffectStatus: this.onEffectStatus,
			videoFrames: this.videoFrames,
			videoFrameVersions: this.videoFrameVersions,
			assets: this.assets,
			automations: this.automations,
			visualModule,
			assetTextures: this.assetTextures,
			audioSources: this.audioSources,
			effectDefinitions: this.effectDefinitions,
			effectImplementations: this.effectImplementations,
		});

		this.liveRenderLoop.start();
	}

	private renderLiveFrame(timing: LiveFrameTiming) {
		if (this.liveVisualModuleRenderer == null) return;
		const commandEncoder = this.gpuDevice.createCommandEncoder();

		const tex = this.liveVisualModuleRenderer.render({
			paramValues: this.liveParamValues,
			time: timing.time,
			timeDelta: timing.timeDelta,
			pointerPosition: this.pointerPosition,
			pointerPositionPrev: this.pointerPositionPrev,
		}, commandEncoder);
		if (tex == null) return;

		this.renderToCanvas(tex, commandEncoder);

		this.pointerPositionPrev = { ...this.pointerPosition };

		this.fpsAverage.addSample(1000 / timing.realTimeDelta);

		if (this.enableStats) {
			this.timingHelper.getResult().then(gpuTime => {
				this.gpuAverageFast.addSample(gpuTime / 1000);
				this.gpuAverageMedium.addSample(gpuTime / 1000);
				this.gpuAverageSlow.addSample(gpuTime / 1000);
			});
		}
	}

	public stopRenderLoop() {
		this.liveRenderLoop.stop();
		this.liveVisualModuleId = null;
		this.liveVisualModuleRenderer?.destroy();
		this.liveVisualModuleRenderer = null;
	}

	public resize(resolution: {
		width: number;
		height: number;
	}) {
		this.clearTimelineRenderers();
		this.resolution = resolution;
		this.liveVisualModuleRenderer?.resize(resolution);
	}

	public destroy() {
		this.stopRenderLoop();
		this.clearTimelineRenderers();
		for (const id of this.audioPorts.keys()) this.resetAudioSource(id, null);
		for (const frame of this.videoFrames.values()) frame.close();
		this.videoFrames.clear();
		this.videoFrameVersions.clear();
		this.gpuHistogram.dispose();
		this.gpuWaveformHorizontal.dispose();
		this.gpuWaveformVertical.dispose();

		this.gpuDevice?.destroy();
	}
}
