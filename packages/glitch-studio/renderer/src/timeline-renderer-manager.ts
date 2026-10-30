import { createTimelineLayerCustomParameterContextIndex } from '@gs/subsystems_timeline_shared/custom-parameters.ts';
import type { TimelineLayerCustomParameterContext } from '@gs/subsystems_timeline_shared/custom-parameters.ts';
import { createTransformTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/transform/transform-timeline-layer.ts';
import { TimelineTransformParameters } from '@gs/subsystems_timeline_shared/layers/transform/transform-parameters.ts';
import { isTimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { getTimelineRenderLayers, flattenTimelineLayers, findTimelineLayer, findTimelineLayerLocation } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { createGroupTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/group/group-timeline-layer.ts';
import { createSpeechResolver } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import { getTimelineMotionBlurBoundaries, getTimelineMotionBlurCameraCuts, getTimelineMotionBlurLoops, getTimelineSampleTimes } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import { TimelineFrameRenderer } from '@gs/subsystems_timeline_renderer/timeline-frame-renderer.ts';
import { createMotionBlurAccumulator } from '@gs/subsystems_timeline_renderer/motion-blur-accumulator.ts';
import { scaleResolution, type Resolution } from '@gs/shared/resolution.ts';
import { getTimelineScene } from '@gs/subsystems_timeline_shared/scenes.ts';
import { applyRendererProjectChanges, findRendererVisualModule } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { getSceneBaseResolution, resolveSceneResolution } from '@gs/subsystems_timeline_shared/scene-resolution.ts';
import EventEmitter from 'eventemitter3';
import { VisualModuleRenderer } from '@gs/subsystems_visual-module_renderer/visual-module-renderer.ts';
import { createVisualModuleTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/visual-module/visual-module-timeline-layer.ts';
import { createSceneTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/scene/scene-timeline-layer.ts';
import { createImageTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/image/image-timeline-layer.ts';
import { createEffectTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/effect/effect-timeline-layer.ts';
import { createVoicevoxTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/voicevox/voicevox-timeline-layer.ts';
import { createTextTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/text/text-timeline-layer.ts';
import { createShapeTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/shape/shape-timeline-layer.ts';
import { createSceneOutput } from '@gs/subsystems_timeline_renderer/scene-output.ts';
import { getTimelineScenesWithProjectAutomationGraphs } from '@gs/glitch-studio_shared/project/automation-graphs.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import { createTimelineCompositor } from '@gs/subsystems_timeline_renderer/timeline-compositor.ts';
import { TimelineCompositingParameters } from '@gs/subsystems_timeline_renderer/timeline-compositing-parameters.ts';
import { isTimelineClipActive } from '@gs/subsystems_timeline_shared/timing.ts';
import { createVideoTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/video/video-timeline-layer.ts';
import { TimelineRenderer } from '@gs/subsystems_timeline_renderer/timeline-renderer.ts';
import { TimelineSceneCamera } from '@gs/subsystems_timeline_shared/scene-camera.ts';
import { isTimelineVisualLayer, getTimelineLayerTransformTarget } from '@gs/subsystems_timeline_shared/types.ts';
import { getTimelinePreviewParent } from '@gs/subsystems_timeline_shared/group-space.ts';
import { timelineImageFrame } from '@gs/subsystems_timeline_renderer/timeline-image.ts';
import { invertTimelineAffine, TIMELINE_IDENTITY, TIMELINE_FRAME } from '@gs/subsystems_timeline_shared/spatial.ts';
import { TimelinePreviewScheduler } from '@gs/subsystems_timeline_renderer/timeline-preview-scheduler.ts';
import defaultVertexShaderCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { CanvasRenderer } from './canvas-renderer.ts';
import type { CpuPreviewFrameReservation } from './cpu-preview-frame-queue.ts';
import { createPreviewCanvasContext } from './preview-canvas-context.ts';
import type { PreviewCanvasContext, PreviewDisplayMode, CpuPreviewFrame, CpuPreviewCanvasTarget } from './preview-canvas-context.ts';
export type { PreviewDisplayMode, CpuPreviewFrame } from './preview-canvas-context.ts';
import { ProjectStateVersions } from './project-state-versions.ts';
import { AssetTextures } from './asset-textures.ts';
import { TimelineAudioInputs } from './timeline-audio-inputs.ts';
import { TimelinePreviewStatisticsCollector } from './timeline-preview-statistics.ts';
import { TimelinePreviewFrameCache } from './timeline-preview-frame-cache.ts';
import { getTimelinePreviewFrameIndex } from '@gs/glitch-studio_shared/timeline-preview-frame.ts';
import type { TimelinePreviewFrameCacheState, TimelinePreviewSeekMode } from '@gs/glitch-studio_shared/timeline-preview-frame.ts';
import type { TimelinePreviewCachedFrame } from './timeline-preview-frame-cache.ts';
import type { TimelinePreviewFrameTiming, TimelinePreviewStatistics } from './timeline-preview-statistics.ts';
import type { TimelineTransformObservation, TimelineTransformPreview } from '@gs/glitch-studio_shared/timeline-transform-preview.ts';
import type { TimelineCompositingObserver } from '@gs/subsystems_timeline_renderer/timeline-compositor.ts';
import type { TimelineMotionBlurCameraCuts, TimelineMotionBlurLoop } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import type { GeneratedSpeech } from '@gs/glitch-studio_shared/voicevox.ts';
import type { TimelineMotionBlurSettings } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import type { VisualModuleTarget } from '@gs/glitch-studio_shared/project/visual-module-target.ts';
import type { RendererProjectChange, RendererProjectState } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import type { ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';
import type { TimelineImage } from '@gs/subsystems_timeline_renderer/timeline-image.ts';
import type { FrameScheduler } from '@gs/subsystems_visual-module_renderer/visual-module-live-preview-render-loop.ts';
import type { TimelineLayerRenderer } from '@gs/subsystems_timeline_renderer/timeline-renderer.ts';
import type { EffectInstanceState } from '@gs/subsystems_effect_shared/effect-status.ts';
import type { Asset, IntermediateTextureFormat } from '@gs/shared/types.ts';
import type { TimelineScene, TimelineLayer, TimelineVisualModuleLayer, TimelineInlineVisualModuleLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { VisualModule, VisualModuleCustomParameterId } from '@gs/subsystems_visual-module_shared/types.ts';
import type { EffectImplementation } from '@gs/subsystems_effect_shared/effect-implementation.js';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.js';

export type { TimelinePreviewFrameTiming, TimelinePreviewStatistics } from './timeline-preview-statistics.ts';

/**
 * 初期化時に決まっている必要がある設定情報
 */
export type TimelineRendererManagerStaticOptions = {
	previewDisplayMode?: PreviewDisplayMode;
	enableStats: boolean;
	/** プレビュー用の波形・ヒストグラムのGPU処理を有効にする。 */
	enableWaveformAndHistogram: boolean;
	timelineFps: number;
	timelineMotionBlur: TimelineMotionBlurSettings;
	enable32bitDataTextures: boolean;
	/** 画像の中間テクスチャ形式。Canvas・データ用テクスチャには適用しない。 */
	intermediateTextureFormat: IntermediateTextureFormat;
	/** 処理中の1件に追加できる先行数。省略時は1、0ではGPU完了まで直列に処理する。 */
	previewFramesAhead?: number;
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
	generatedSpeech: GeneratedSpeech[];
	visualModules: ProjectVisualModule[];
	timelineScenes: TimelineScene[];
	automationGraphs: AutomationGraph[];
	sceneId: string | null;
	transformObserver: TimelineTransformObservation | null;
	/** UIから送られた状態の世代。既存の更新RPCに同梱し、古い枠の採用を防ぐ。 */
	previewRevision: number;
	/** nullではプロジェクト基準fpsを使用する。露光時間とは独立したプレビューの時計。 */
	previewFps: number | null;
	/** プレビュー用の容量上限。0では複製・保持・通知を行わない。 */
	frameCacheMaxBytes: number;
};

/** 素材一覧はManagerの寿命中に固定し、変更時はManagerを再生成する。 */
export type TimelineRendererManagerResources = { assets: readonly Asset[] };

/** Managerが所有するGPU環境と、注入する描画機能。 */
export type TimelineRendererManagerCoreConfig = {
	gpuDevice: GPUDevice;
	gpuContext: PreviewCanvasContext;
	frameScheduler?: FrameScheduler;
	histogramGpuContext?: PreviewCanvasContext;
	waveformHorizontalGpuContext?: PreviewCanvasContext;
	waveformVerticalGpuContext?: PreviewCanvasContext;
	effectDefinitions: Record<string, EffectDefinition<any>>;
	effectImplementations: Record<string, EffectImplementation<any>>;
};

type CachedLayerTransform = Pick<TimelineTransformPreview, 'clipId' | 'geometry' | 'outputResolution' | 'parentGeometries'>;
type PreviewFrameCapture = {
	time: number;
	frameIndex: number | null;
	transforms: Map<string, CachedLayerTransform>;
	/** nullのカメラも評価済みとして保持し、露光サンプル間でも基準時刻の結果を共有する。 */
	cameraEvaluation: { camera: ReturnType<TimelineSceneCamera['evaluate']> } | null;
	snapshot: TimelinePreviewCachedFrame<ReadonlyMap<string, CachedLayerTransform>> | null;
	captureError: Promise<GPUError | null> | null;
	cpuFrame: CpuPreviewFrameReservation | null;
	cpuPresentation: Promise<void> | null;
};

// エフェクトは配置場所を知らず、インスタンスを所有するManagerが通知元を付加する。
export type TimelineLayerStatusSource = {
	type: 'timelineLayer'; instanceId: string; layerId: string; clipId: string; rootSceneId: string; layerPath: string[];
};

export type TimelineRendererManagerEvents = {
	'cpuPreviewFrame': (ctx: CpuPreviewFrame) => void;
	'telemetry': (ctx: TimelinePreviewStatistics) => void;
	'frameCache': (ctx: TimelinePreviewFrameCacheState) => void;
	/** 完了通知を要求した手動シークだけを、最終出力のGPU処理完了後に通知する。 */
	'frameRendered': (ctx: { requestId: number; sceneId: string | null; time: number; revision: number }) => void;
	'effectState': (ctx: { source: TimelineLayerStatusSource; nodeId: string; status: EffectInstanceState | null }) => void;
	'effectLayerState': (ctx: { source: TimelineLayerStatusSource; status: EffectInstanceState | null }) => void;
	'renderError': (ctx: { message: string }) => void;
	'layerTransform': (ctx: TimelineTransformPreview) => void;
};

export class TimelineRendererManager extends EventEmitter<{
	'ev': (ctx: { [K in keyof TimelineRendererManagerEvents]: { type: K; ctx: Parameters<TimelineRendererManagerEvents[K]>[0] } }[keyof TimelineRendererManagerEvents]) => void;
}> {
	private timelineRenderer: TimelineRenderer<TimelineImage, TimelineLayer>;
	private previewRenderGeneration = 0;
	private previewFrameSequence = 0;
	private publishedPreviewFrameSequence = 0;
	private previewFrameTiming: TimelinePreviewFrameTiming | null = null;
	private previewStatistics = new TimelinePreviewStatisticsCollector();
	private telemetryReportIntervalId: ReturnType<typeof setInterval> | null = null;
	private frameRenderedRequestId: number | null = null;
	private previewSeekMode: TimelinePreviewSeekMode = 'frame';
	private frameCache: TimelinePreviewFrameCache<ReadonlyMap<string, CachedLayerTransform>>;
	private frameCacheRevision = 0;
	private frameCacheReportIntervalId: ReturnType<typeof setInterval> | null = null;
	private activePreviewFrame: PreviewFrameCapture | null = null;
	private frameRenderer: TimelineFrameRenderer<TimelineImage>;
	private motionBlurAccumulator: ReturnType<typeof createMotionBlurAccumulator> | null = null;
	private motionBlurTiming: { boundaries: number[]; loops: TimelineMotionBlurLoop[]; cameras: TimelineMotionBlurCameraCuts[] } | null = null;
	private resolveSpeech = createSpeechResolver([]);
	private nextTimelineLayerStatusId = 0;
	private previewScheduler: TimelinePreviewScheduler;
	private gpuContext: PreviewCanvasContext;
	private gpuDevice: GPUDevice;
	private canvasRenderer: CanvasRenderer;
	private defaultVertexShaderModule: GPUShaderModule;
	private fallbackTexture: GPUTexture;
	private sceneOutput: ReturnType<typeof createSceneOutput> | null = null;
	private assetTextures: AssetTextures;
	private readonly resources: TimelineRendererManagerResources;
	private audioInputs: TimelineAudioInputs;
	private effectDefinitions: Record<string, EffectDefinition<any>>;
	private effectImplementations: Record<string, EffectImplementation<any>>;
	private projectVersions = new ProjectStateVersions();
	private evaluationScenes: TimelineScene[] = [];
	private customParameterContextsBySceneId = new Map<string, ReadonlyMap<string, TimelineLayerCustomParameterContext>>();
	private pendingTransformPreview: TimelineTransformPreview | null = null;
	private lastTransformPreview: TimelineTransformPreview | null = null;
	private transformPreviewParameters = new TimelineCompositingParameters();
	private transformPreviewContainerParameters = new TimelineTransformParameters();
	private transformPreviewCamera = new TimelineSceneCamera();

	private readonly staticOptions: TimelineRendererManagerStaticOptions;
	private dynamicOptions: TimelineRendererManagerDynamicOptions = {
		resolution: { width: 1, height: 1 },
		resolutionScale: 1,
		outputResolution: null,
		highlightClipping: false,
		opaqueOutput: false,
		generatedSpeech: [],
		visualModules: [],
		timelineScenes: [],
		automationGraphs: [],
		sceneId: null,
		transformObserver: null,
		previewRevision: 0,
		previewFps: null,
		frameCacheMaxBytes: 0,
	};

	private constructor(coreConfig: TimelineRendererManagerCoreConfig, staticOptions: TimelineRendererManagerStaticOptions, resources: TimelineRendererManagerResources) {
		super();
		this.staticOptions = { ...staticOptions, timelineMotionBlur: { ...staticOptions.timelineMotionBlur } };
		this.resources = resources;
		this.audioInputs = new TimelineAudioInputs(resources.assets);
		this.previewScheduler = new TimelinePreviewScheduler(
			(time, timeDelta, onSubmitted) => this.renderPreviewFrame(time, timeDelta, onSubmitted),
			(staticOptions.previewFramesAhead ?? 1) + 1,
		);

		this.gpuDevice = coreConfig.gpuDevice;
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
		this.frameCache = new TimelinePreviewFrameCache(this.gpuDevice, this.defaultVertexShaderModule);

		this.canvasRenderer = new CanvasRenderer({
			gpuDevice: this.gpuDevice,
			gpuContext: this.gpuContext,
			enableWaveformAndHistogram: this.staticOptions.enableWaveformAndHistogram,
			histogramGpuContext: coreConfig.histogramGpuContext,
			waveformHorizontalGpuContext: coreConfig.waveformHorizontalGpuContext,
			waveformVerticalGpuContext: coreConfig.waveformVerticalGpuContext,
		});

		const camera = new TimelineSceneCamera();
		this.timelineRenderer = new TimelineRenderer<TimelineImage, TimelineLayer>({
			getRenderSpace: (time, isExport, referenceTime) => ({
				parent: TIMELINE_IDENTITY,
				depth: 0,
				viewport: TIMELINE_FRAME,
				camera: camera.evaluate(this.evaluationScenes.find(scene => scene.id === this.dynamicOptions.sceneId)?.layers ?? [], time, isExport,
					scaleResolution(this.sceneBaseResolution, this.dynamicOptions.resolutionScale), referenceTime?.timeMs),
			}),
			fallbackOutput: { kind: 'uniform', value: [0, 0, 0, 0] },
			createLayer: (entry, clipId) => this.createTimelineLayer(entry, clipId, [entry.id], this.sceneBaseResolution),
			getLayerVersion: (entry, clipId) => this.getLayerVersion(this.dynamicOptions.sceneId!, entry, clipId),
			present: output => this.presentOutput(output),
			onClear: () => {
				this.canvasRenderer.clear();
			},
		});
		this.frameRenderer = new TimelineFrameRenderer({
			evaluate: (time, delta, isExport, signal, referenceTime) => this.timelineRenderer.evaluateAt(time, this.getSceneLayers(), delta, isExport, signal, referenceTime),
			accumulate: (output, index) => {
				this.motionBlurAccumulator ??= createMotionBlurAccumulator({
					device: this.gpuDevice,
					vertex: this.defaultVertexShaderModule,
					resolution: this.renderResolution,
					enable32bitDataTextures: this.staticOptions.enable32bitDataTextures,
				});
				const encoder = this.gpuDevice.createCommandEncoder();
				const averaged = this.motionBlurAccumulator.add(encoder, output, index);
				// 借用した出力は次の評価で上書き・破棄され得るので、必ず先にGPUへ送信する。
				this.gpuDevice.queue.submit([encoder.finish()]);
				return averaged;
			},
			present: output => this.presentOutput(output),
		});
		if (this.staticOptions.enableStats) this.telemetryReportIntervalId = setInterval(() => this.reportPreviewStatistics(), 100);
		this.assetTextures = new AssetTextures(this.gpuDevice, resources.assets);
	}

	/** 準備済みのManagerだけを返す。渡されたGPUDeviceは、生成失敗・中断時にもここで解放する。 */
	public static async create(coreConfig: TimelineRendererManagerCoreConfig, staticOptions: TimelineRendererManagerStaticOptions,
		resources: TimelineRendererManagerResources, signal?: AbortSignal): Promise<TimelineRendererManager> {
		let manager: TimelineRendererManager | null = null;
		try {
			signal?.throwIfAborted();
			manager = new TimelineRendererManager(coreConfig, staticOptions, resources);
			coreConfig.gpuDevice.addEventListener?.('uncapturederror', event => manager?.emit('ev', { type: 'renderError', ctx: { message: event.error.message } }));
			void coreConfig.gpuDevice.lost?.then(info => { if (info.reason !== 'destroyed') manager?.emit('ev', { type: 'renderError', ctx: { message: info.message || 'GPU device was lost' } }); });
			await manager.assetTextures.waitUntilReady(signal);
			signal?.throwIfAborted();
			return manager;
		} catch (error) {
			// 生成中のManagerを外へ渡さず、遅れて完了するデコードもGPUを使えない状態にする。
			if (manager != null) manager.destroy();
			else coreConfig.gpuDevice.destroy();
			throw error;
		}
	}

	private reportPreviewStatistics() {
		const statistics = this.previewStatistics.take();
		if (statistics != null && statistics.sceneId === this.dynamicOptions.sceneId && statistics.revision === this.dynamicOptions.previewRevision) {
			this.emit('ev', { type: 'telemetry', ctx: statistics });
		}
	}

	private presentOutput(output: TimelineImage) {
		const encoder = this.gpuDevice.createCommandEncoder();
		this.sceneOutput ??= createSceneOutput({
			device: this.gpuDevice,
			vertex: this.defaultVertexShaderModule,
			resolution: this.renderResolution,
			format: this.staticOptions.intermediateTextureFormat,
		});
		const texture = this.sceneOutput.render(encoder, output);
		this.canvasRenderer.renderToCanvas(texture, encoder);
		this.submitPreviewOutput(encoder);

		const capture = this.activePreviewFrame;
		if (capture?.frameIndex != null && this.frameCache.enabled) {
			// 確保失敗で返る無効なテクスチャはencoderも無効にし得る。表示を先に
			// submitし、複製は別のencoder・submitへ隔離する。派生するvalidation
			// errorもここで捕捉し、キャッシュだけの失敗を通常の描画エラーにしない。
			this.gpuDevice.pushErrorScope('out-of-memory');
			this.gpuDevice.pushErrorScope('validation');
			try {
				const captureEncoder = this.gpuDevice.createCommandEncoder();
				capture.snapshot = this.frameCache.capture(captureEncoder, texture, new Map(capture.transforms));
				if (capture.snapshot != null) this.gpuDevice.queue.submit([captureEncoder.finish()]);
			} catch {
				// 同期的な失敗でも表示は送信済み。途中まで生成した複製を回収する。
				capture.snapshot?.texture.destroy();
				capture.snapshot = null;
				this.frameCache.clear();
			} finally {
				// device lossはqueueの待機と既存のlost通知で扱う。先にrejectされても
				// 未処理のPromiseにせず、finallyでキャッシュ用画像を必ず解放する。
				capture.captureError = Promise.all([this.gpuDevice.popErrorScope(), this.gpuDevice.popErrorScope()])
					.then(errors => errors.find(error => error != null) ?? null).catch(() => null);
			}
		}
	}

	private submitPreviewOutput(encoder: GPUCommandEncoder) {
		const capture = this.activePreviewFrame;
		try {
			// 最終描画と読み戻しコピーを一緒に送信し、その後でだけmapAsyncを開始する。
			capture?.cpuFrame?.prepareReadback(encoder);
			this.gpuDevice.queue.submit([encoder.finish()]);
			if (capture?.cpuFrame != null) {
				capture.cpuPresentation = capture.cpuFrame.complete();
				// 上位の描画・キャッシュ準備がawait中でも、読み戻しの失敗を未処理のrejectにしない。
				void capture.cpuPresentation.catch(() => {});
			}
		} catch (error) { capture?.cpuFrame?.cancel(); throw error; }
	}

	private invalidateFrameCache() {
		this.frameCacheRevision++;
		this.frameCache.clear();
	}

	private reportFrameCache() {
		if (!this.frameCache.changed) return;
		this.frameCache.changed = false;
		this.emit('ev', { type: 'frameCache', ctx: { ...this.frameCache.snapshot(),
			sceneId: this.dynamicOptions.sceneId, contentRevision: this.frameCacheRevision,
			previewRevision: this.dynamicOptions.previewRevision, fps: this.dynamicOptions.previewFps ?? this.staticOptions.timelineFps,
		} });
	}

	private reportRenderError(message: string) {
		this.emit('ev', { type: 'renderError', ctx: { message } });
	}

	private clearTimelineRenderers() {
		this.invalidateFrameCache();
		this.previewStatistics.clear();
		this.frameRenderer.clear();
		this.motionBlurTiming = null;
		this.motionBlurAccumulator?.dispose();
		this.motionBlurAccumulator = null;
		this.previewScheduler.clear();
		this.previewRenderGeneration++;
		this.timelineRenderer.clear();
		this.sceneOutput?.dispose();
		this.sceneOutput = null;
	}

	// (非workerで)呼び出すときは値を独立した参照にすること！ パフォーマンス上の理由でこちら側ではdeepCloneしません
	public updateDynamicOptions(newOptions: Partial<TimelineRendererManagerDynamicOptions>) {
		if (Object.hasOwn(newOptions, 'previewFps') && newOptions.previewFps != null && (!Number.isFinite(newOptions.previewFps) || newOptions.previewFps <= 0)) throw new RangeError('Invalid preview FPS');
		if (Object.hasOwn(newOptions, 'frameCacheMaxBytes')) {
			this.frameCache.setMaxBytes(newOptions.frameCacheMaxBytes!);
			if (this.frameCacheReportIntervalId != null) clearInterval(this.frameCacheReportIntervalId);
			this.frameCacheReportIntervalId = this.frameCache.enabled ? setInterval(() => this.reportFrameCache(), 100) : null;
		}
		if (newOptions.generatedSpeech) {
			this.invalidateFrameCache();
			this.frameRenderer.clear();
			this.resolveSpeech = createSpeechResolver(newOptions.generatedSpeech);
			this.audioInputs.setGeneratedSpeech(newOptions.generatedSpeech);
		}
		this.dynamicOptions = { ...this.dynamicOptions, ...newOptions };
		if (Object.hasOwn(newOptions, 'timelineScenes') || Object.hasOwn(newOptions, 'automationGraphs')) this.refreshEvaluationScenes();
		this.canvasRenderer.highlightClipping = this.dynamicOptions.highlightClipping;
		this.canvasRenderer.opaqueOutput = this.dynamicOptions.opaqueOutput;

		// Scene選択・出力解像度のnullは解除要求なので、差分のプロパティの有無で判定する。
		// Partialの差分では省略は変更なし、明示的なnullは解除要求。値の有無ではなくown propertyで判定する。
		if (Object.hasOwn(newOptions, 'resolution') || Object.hasOwn(newOptions, 'resolutionScale') || Object.hasOwn(newOptions, 'visualModules') || Object.hasOwn(newOptions, 'automationGraphs') || Object.hasOwn(newOptions, 'timelineScenes') || Object.hasOwn(newOptions, 'sceneId') || Object.hasOwn(newOptions, 'previewFps')) {
			this.clearTimelineRenderers();
		}
		if (Object.hasOwn(newOptions, 'resolution') || Object.hasOwn(newOptions, 'resolutionScale') || Object.hasOwn(newOptions, 'timelineScenes') || Object.hasOwn(newOptions, 'sceneId') || Object.hasOwn(newOptions, 'outputResolution')) {
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
				this.reportRenderError(error instanceof Error ? error.message : String(error));
				throw error;
			}
		}

		if (Object.hasOwn(newOptions, 'frameCacheMaxBytes') && !this.frameCache.enabled) this.reportFrameCache();
	}

	public replaceProjectState(state: RendererProjectState, previewRevision = this.dynamicOptions.previewRevision + 1) {
		const resolution = this.resolveProjectOutputResolution(state);
		this.clearTimelineRenderers();
		this.projectVersions = new ProjectStateVersions();
		Object.assign(this.dynamicOptions, state);
		this.refreshEvaluationScenes();
		this.dynamicOptions.previewRevision = previewRevision;
		if (!state.timelineScenes.some(scene => scene.id === this.dynamicOptions.sceneId)) this.dynamicOptions.sceneId = null;
		this.gpuContext.canvas.width = resolution.width;
		this.gpuContext.canvas.height = resolution.height;
	}

	public applyProjectChanges(changes: readonly RendererProjectChange[], previewRevision = this.dynamicOptions.previewRevision + 1) {
		const next = applyRendererProjectChanges(this.dynamicOptions, changes);
		const changesRootScene = changes.some(change => change.type === 'scene' && change.sceneId === this.dynamicOptions.sceneId);
		const resolution = changesRootScene ? this.resolveProjectOutputResolution(next) : null;
		// 差分の検証が成功するまで公開状態を変更しない。編集中の非同期フレームは
		// 中断するが、履歴とキャッシュの破棄は変更された配置だけが次の評価で行う。
		this.previewScheduler.clear();
		this.invalidateFrameCache();
		this.previewRenderGeneration++;
		this.timelineRenderer.cancelPendingRender();
		this.frameRenderer.cancel();
		this.motionBlurTiming = null;
		this.projectVersions.apply(changes, this.dynamicOptions);
		Object.assign(this.dynamicOptions, next);
		this.refreshEvaluationScenes();
		if (changes.some(change => change.type === 'automationGraphs')) this.clearTimelineRenderers();
		this.dynamicOptions.previewRevision = previewRevision;
		if (!next.timelineScenes.some(scene => scene.id === this.dynamicOptions.sceneId)) {
			this.dynamicOptions.sceneId = null;
			this.clearTimelineRenderers();
		} else if (resolution != null) {
			this.motionBlurAccumulator?.dispose();
			this.motionBlurAccumulator = null;
			this.sceneOutput?.dispose();
			this.sceneOutput = null;
			this.gpuContext.canvas.width = resolution.width;
			this.gpuContext.canvas.height = resolution.height;
		}
	}

	private refreshEvaluationScenes() {
		this.evaluationScenes = getTimelineScenesWithProjectAutomationGraphs(this.dynamicOptions.timelineScenes, this.dynamicOptions.automationGraphs);
		// 祖先の値変更や階層移動も環境へ反映する。レンダラーの寿命とは分けて更新し、
		// インスタンスを維持する値編集でも古い所有レイヤーを参照し続けないようにする。
		this.customParameterContextsBySceneId = new Map(this.evaluationScenes.map(scene => [scene.id, createTimelineLayerCustomParameterContextIndex(scene.layers)]));
	}

	private getLayerCustomParameterContext(sceneId: string | null, layerId: string): TimelineLayerCustomParameterContext | null {
		return sceneId == null ? null : this.customParameterContextsBySceneId.get(sceneId)?.get(layerId) ?? null;
	}

	private resolveProjectOutputResolution(state: RendererProjectState): Resolution {
		const scene = state.timelineScenes.find(scene => scene.id === this.dynamicOptions.sceneId);
		const sceneResolution = resolveSceneResolution(scene?.resolution ?? { mode: 'project' }, this.dynamicOptions.resolution,
			this.dynamicOptions.resolutionScale, this.gpuDevice.limits.maxTextureDimension2D);
		const resolution = this.dynamicOptions.outputResolution ?? sceneResolution;
		if (![resolution.width, resolution.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= this.gpuDevice.limits.maxTextureDimension2D)) {
			throw new Error(`Invalid output resolution: ${resolution.width} × ${resolution.height}`);
		}
		return resolution;
	}

	private getLayer(sceneId: string, layerId: string) {
		return findTimelineLayer(getTimelineScene(this.evaluationScenes, sceneId).layers, layerId);
	}

	private getLayerVersion(sceneId: string, layer: TimelineLayer, clipId: string | null): string {
		const childId = layer.layerType === 'scene' ? layer.clips.find(clip => clip.id === clipId)!.sceneId : null;
		return JSON.stringify([this.projectVersions.scene(sceneId), this.projectVersions.layer(sceneId, layer.id),
																									childId == null ? 0 : this.projectVersions.scene(childId)]);
	}

	/** timeはミリ秒。表示期間中はレイヤーごとのインスタンスと履歴を保持する。 */
	public renderTimelineAt(time: number, frameRenderedRequestId: number | null = null, seekMode: TimelinePreviewSeekMode = 'frame'): Promise<void> {
		// Schedulerが最新の待機位置だけを保持するのに合わせ、通知対象も置き換える。
		// 描画開始時にIDを取り出すため、間引かれた要求を完了として通知しない。
		// 再生時はnullで通知を止め、フレームごとのWorker通信を追加しない。
		this.frameRenderedRequestId = frameRenderedRequestId;
		this.previewSeekMode = seekMode;
		return this.previewScheduler.render(time);
	}

	private async renderPreviewFrame(time: number, timeDelta: number, onSubmitted: () => void): Promise<boolean> {
		const generation = this.previewRenderGeneration;
		const sequence = ++this.previewFrameSequence;
		const contentRevision = this.frameCacheRevision;
		const fps = this.dynamicOptions.previewFps ?? this.staticOptions.timelineFps;
		const frameIndex = getTimelinePreviewFrameIndex(time, fps);
		// 呼び出し側が表示時刻を所有する。任意時刻を同じ番号へ誤って保存しないよう、
		// 精密シークとフレーム境界以外の直接呼び出しは検索・保存の両方を省く。
		const capture: PreviewFrameCapture = { time, frameIndex: this.previewSeekMode === 'frame' && Number.isFinite(time)
			&& Math.abs(time - frameIndex * 1000 / fps) < 1e-7 && this.frameCache.enabled ? frameIndex : null,
		transforms: new Map(), cameraEvaluation: null, snapshot: null, captureError: null, cpuFrame: null, cpuPresentation: null };
		this.activePreviewFrame = capture;
		// CPU側の評価・送信は直列なので、子Scene・複数レイヤー・ブラーの集計はこの1フレームに属する。
		// GPU通知待ちへ移る前に共有の参照を外し、先行する次フレームの計測と混ざらないようにする。
		const timing: TimelinePreviewFrameTiming | null = this.staticOptions.enableStats
			? {
				frameDurationMs: 0,
				videoSampleWaitMs: 0,
				videoUploadCpuMs: 0,
				gpuWaitMs: 0,
			} : null;
		this.previewFrameTiming = timing;
		const frameStartedAt = timing != null ? performance.now() : 0;
		const frameRenderedRequestId = this.frameRenderedRequestId;
		const sceneId = this.dynamicOptions.sceneId;
		const revision = this.dynamicOptions.previewRevision;
		const request = this.dynamicOptions.transformObserver;
		const location = request?.sceneId === this.dynamicOptions.sceneId ? findTimelineLayerLocation(this.getSceneLayers(), request.layerId) : null;
		const layer = location && !location.layer.isDisabled && !location.ancestors.some(group => group.isDisabled) && isTimelineVisualLayer(location.layer) ? location.layer : null;
		const clip = layer && !isTimelineContainerLayer(layer) ? layer.clips.find(clip => isTimelineClipActive(clip, time)) : null;
		const preview: TimelineTransformPreview | null = request ? {
			request,
			revision: this.dynamicOptions.previewRevision,
			time,
			clipId: clip?.id ?? null,
			geometry: null,
			outputResolution: null,
		} : null;
		this.pendingTransformPreview = preview;
		try {
			if (this.canvasRenderer.usesCpuDisplay) {
				// 評価・GPU描画の前にUI返却までの表示枠を予約する。満杯なら最後のシーク画像も待って表示する。
				capture.cpuFrame = await this.canvasRenderer.reserveCpuPreviewFrame();
				if (capture.cpuFrame == null || generation !== this.previewRenderGeneration) return false;
			}
			let prepared = false;
			try {
				if (!Number.isFinite(time)) throw new Error('Timeline time must be finite');
				const cached = capture.frameIndex != null ? this.frameCache.get(capture.frameIndex) : null;
				if (cached != null) {
					if (preview != null) Object.assign(preview, cached.metadata.get(preview.request.layerId) ?? {});
					const encoder = this.gpuDevice.createCommandEncoder();
					this.canvasRenderer.renderToCanvas(cached.texture, encoder);
					this.submitPreviewOutput(encoder);
				} else {
					await this.renderFrame(time, false, this.staticOptions.timelineFps, timeDelta);
				}
				prepared = true;
			} finally {
				// 送信後は設定された上限まで次の準備を許可する。GPU完了を待つこの関数の寿命と、
				// CPU側の評価で使う参照の寿命を分け、前フレームの後始末で次の参照を消さない。
				if (this.activePreviewFrame === capture) this.activePreviewFrame = null;
				if (this.previewFrameTiming === timing) this.previewFrameTiming = null;
				if (this.pendingTransformPreview === preview) this.pendingTransformPreview = null;
				const gpuWaitStartedAt = timing != null ? performance.now() : 0;
				// 読み戻しのコピーも同じqueueへ先に送る。次の準備を許可しても、
				// 各フレームは専用のバッファを持ち、読み戻し・UIへの送信が終わるまで完了扱いにしない。
				// 同じWorkerからの通知順により、UIは画像を描いてからframeRenderedを受け取る。
				const cpuPresented = capture.cpuPresentation;
				const completed = this.gpuDevice.queue.onSubmittedWorkDone().finally(() => {
					if (timing != null) timing.gpuWaitMs = performance.now() - gpuWaitStartedAt;
				});
				if (prepared) onSubmitted();
				await Promise.all([completed, cpuPresented]);
			}
			if (capture.cpuFrame?.isCancelled === true) return false;
			const captureError = await capture.captureError;
			if (capture.snapshot != null && captureError == null && capture.frameIndex != null
				&& contentRevision === this.frameCacheRevision && generation === this.previewRenderGeneration) {
				this.frameCache.commit(capture.frameIndex, capture.snapshot);
				capture.snapshot = null;
			}
			if (captureError != null) this.frameCache.clear();
			if (timing != null) timing.frameDurationMs = performance.now() - frameStartedAt;
			if (timing != null && generation === this.previewRenderGeneration && sceneId === this.dynamicOptions.sceneId && revision === this.dynamicOptions.previewRevision) {
				this.previewStatistics.addFrame(sceneId, revision, timing);
			}
			// 編集や破棄で無効になったフレームの変形情報を、現在の表示へ反映しない。
			if (generation === this.previewRenderGeneration && sequence >= this.publishedPreviewFrameSequence && preview && this.dynamicOptions.transformObserver === request) {
				// ブラーのサブサンプルごとには通知しない。枠の変形は基準時刻で評価し、
				// 寸法には実際の合成前出力を使う。画像の読み戻し・ハンドル用の再描画は不要。
				const blur = this.staticOptions.timelineMotionBlur;
				if (preview.geometry && layer && blur.enabled && blur.shutterAngle > 0 && blur.samples > 1) {
					const { position, origin, scale, rotation, fitMode } = this.transformPreviewParameters.evaluate({
						time,
						isExport: false,
						coordinateSpace: layer.coordinateSpace,
						mask: layer.mask,
						layerMask: layer.layerMask,
						transformTarget: getTimelineLayerTransformTarget(layer),
						paramValues: layer.compositingParamValues,
						automationGraphs: layer.automationGraphs,
						customParameters: this.getLayerCustomParameterContext(sceneId, layer.id),
					});
					preview.geometry.transform = {
						position,
						origin,
						scale,
						rotation,
						fitMode,
					};
				}
				this.publishedPreviewFrameSequence = sequence;
				this.publishTransformPreview(preview);
			}
			if (generation === this.previewRenderGeneration && frameRenderedRequestId != null
				&& frameRenderedRequestId === this.frameRenderedRequestId && revision === this.dynamicOptions.previewRevision) {
				this.emit('ev', {
					type: 'frameRendered',
					ctx: {
						requestId: frameRenderedRequestId,
						sceneId,
						time,
						revision,
					},
				});
			}
			return true;
		} catch (error) {
			capture.cpuFrame?.cancel();
			if (generation === this.previewRenderGeneration) {
				this.reportRenderError(error instanceof Error ? error.message : String(error));
				if (preview != null && this.dynamicOptions.transformObserver === request) this.publishTransformPreview({ ...preview, geometry: null, outputResolution: null });
			}
			return false;
		} finally {
			if (capture.cpuPresentation == null) capture.cpuFrame?.cancel();
			capture.snapshot?.texture.destroy();
			if (this.activePreviewFrame === capture) this.activePreviewFrame = null;
			if (this.previewFrameTiming === timing) this.previewFrameTiming = null;
			if (this.pendingTransformPreview === preview) this.pendingTransformPreview = null;
		}
	}

	private publishTransformPreview(preview: TimelineTransformPreview) {
		if (deepEqual(preview, this.lastTransformPreview)) return;
		this.lastTransformPreview = preview;
		this.emit('ev', { type: 'layerTransform', ctx: preview });
	}

	private createCompositingObserver(sceneId: string, layerId: string, clipId: string | null, sceneSize: Resolution): TimelineCompositingObserver | null {
		if (sceneId !== this.dynamicOptions.sceneId) return null;
		return (source) => {
			const pending = this.pendingTransformPreview;
			const capture = this.activePreviewFrame;
			const observed = pending != null && pending.request.sceneId === sceneId && pending.request.layerId === layerId && pending.clipId === clipId;
			if (!observed && capture?.frameIndex == null) return;
			const time = capture?.time ?? pending!.time;
			const preview: CachedLayerTransform = { clipId, geometry: null, outputResolution: null };
			const location = findTimelineLayerLocation(this.getSceneLayers(), layerId);
			const layer = location?.layer;
			if (!layer || !isTimelineVisualLayer(layer)) return;
			// 文字やグループのframeSizeは配置用の基準枠で、枠外の画素や画素密度の制限を含む
			// 実テクスチャ寸法とは異なる。表示する解像度は実寸を既存の購読通知へ同梱する。
			preview.outputResolution = source.kind === 'texture' ? { width: source.texture.width, height: source.texture.height } : null;
			const evaluate = (entry: Extract<TimelineLayer, { compositingParamValues: unknown }>) => this.transformPreviewParameters.evaluate({
				time,
				isExport: false,
				coordinateSpace: entry.coordinateSpace,
				mask: entry.mask,
				layerMask: entry.layerMask,
				transformTarget: getTimelineLayerTransformTarget(entry),
				paramValues: entry.compositingParamValues,
				automationGraphs: entry.automationGraphs,
				customParameters: this.getLayerCustomParameterContext(sceneId, entry.id),
			});
			const settings = evaluate(layer);
			const cameraEvaluation = capture?.cameraEvaluation ?? {
				camera: this.transformPreviewCamera.evaluate(this.evaluationScenes.find(scene => scene.id === sceneId)?.layers ?? [], time, false, sceneSize),
			};
			if (capture != null) capture.cameraEvaluation = cameraEvaluation;
			const parent = getTimelinePreviewParent(location.ancestors.filter(parent => parent.layerType === 'group' || parent.layerType === 'transform').map(parent => parent.layerType === 'transform'
				? { transform: this.transformPreviewContainerParameters.evaluate(parent.transformParamValues, parent.automationGraphs, time, false, this.getLayerCustomParameterContext(sceneId, parent.id)) }
				: { settings: evaluate(parent), compositingMode: parent.compositingMode }), settings, sceneSize,
			{
				parent: TIMELINE_IDENTITY,
				depth: 0,
				camera: cameraEvaluation.camera,
				viewport: TIMELINE_FRAME,
			});
			// 範囲モードのハンドルは出力の物理解像度・比率に依存しないSceneの矩形を操作する。
			preview.geometry = parent && invertTimelineAffine(parent) ? { sourceSize: settings.transformTarget === 'region' ? sceneSize : timelineImageFrame(source, sceneSize), sceneSize, transform: settings } : null;
			preview.parentGeometries = parent ? [{
				sourceSize: sceneSize,
				sceneSize,
				transform: {
					position: [0, 0],
					origin: [0, 0],
					scale: [1, 1],
					rotation: 0,
					fitMode: 'stretch',
				},
				matrix: parent,
			}] : [];
			if (capture?.frameIndex != null) capture.transforms.set(layerId, preview);
			if (observed) Object.assign(pending!, preview);
		};
	}

	/** 専用インスタンスで順番に呼び、フレーム間の履歴と一定の経過時間を保持する。 */
	public async renderTimelineFrame(time: number, timeDelta: number, fps = this.staticOptions.timelineFps): Promise<void> {
		// 書き出しfpsはプロジェクト基準とは別に指定できるため、呼び出し境界で検証する。
		await this.renderFrame(time, true, fps, timeDelta);
	}

	private async renderFrame(time: number, isExport: boolean, fps = this.staticOptions.timelineFps, initialTimeDelta = 0) {
		const settings = this.staticOptions.timelineMotionBlur;
		if (!settings.enabled || settings.shutterAngle === 0 || settings.samples <= 1) {
			// 単発描画ではサンプル配列や露光全体用の中断管理を作らない。
			// 直前の複数サンプル描画が待機中なら、残りの評価・表示も止める。
			this.frameRenderer.cancel();
			return this.timelineRenderer.renderAt(time, this.getSceneLayers(), initialTimeDelta, isExport);
		}
		this.motionBlurTiming ??= this.dynamicOptions.sceneId == null ? { boundaries: [], loops: [], cameras: [] } : {
			boundaries: getTimelineMotionBlurBoundaries(this.evaluationScenes, this.dynamicOptions.sceneId),
			loops: getTimelineMotionBlurLoops(this.evaluationScenes, this.dynamicOptions.sceneId),
			cameras: getTimelineMotionBlurCameraCuts(this.evaluationScenes, this.dynamicOptions.sceneId),
		};
		const times = getTimelineSampleTimes(time, fps, settings, this.motionBlurTiming.boundaries, this.motionBlurTiming.loops, this.motionBlurTiming.cameras);
		return this.frameRenderer.render(time, times, isExport, initialTimeDelta);
	}

	private get renderResolution(): Resolution {
		return resolveSceneResolution(this.dynamicOptions.sceneId == null ? { mode: 'project' }
			: getTimelineScene(this.evaluationScenes, this.dynamicOptions.sceneId).resolution,
		this.dynamicOptions.resolution, this.dynamicOptions.resolutionScale, this.gpuDevice.limits.maxTextureDimension2D);
	}

	private get sceneBaseResolution(): Resolution {
		return this.dynamicOptions.sceneId == null ? this.dynamicOptions.resolution
			: getSceneBaseResolution(getTimelineScene(this.evaluationScenes, this.dynamicOptions.sceneId).resolution, this.dynamicOptions.resolution);
	}

	private getSceneLayers() {
		return this.dynamicOptions.sceneId == null ? [] : getTimelineRenderLayers(getTimelineScene(this.evaluationScenes, this.dynamicOptions.sceneId).layers);
	}

	private createTimelineLayer(layer: TimelineLayer, clipId: string | null, layerPath: string[], sceneBaseResolution: Resolution, sceneId = this.dynamicOptions.sceneId!): TimelineLayerRenderer<TimelineImage> {
		const renderer = this.createTimelineLayerRenderer(layer, clipId, layerPath, sceneBaseResolution, sceneId);
		const customParameters = () => this.getLayerCustomParameterContext(sceneId, layer.id);
		return {
			...renderer,
			evaluate: (context, signal) => renderer.evaluate({ ...context, customParameters: customParameters() }, signal),
			createChildren: renderer.createChildren == null ? undefined : (context, options) => renderer.createChildren!({ ...context, customParameters: customParameters() }, options),
		};
	}

	private createTimelineLayerRenderer(layer: TimelineLayer, clipId: string | null, layerPath: string[], sceneBaseResolution: Resolution, sceneId = this.dynamicOptions.sceneId!): TimelineLayerRenderer<TimelineImage> {
		const renderResolution = scaleResolution(sceneBaseResolution, this.dynamicOptions.resolutionScale);
		if (layer.layerType === 'transform') {
			return createTransformTimelineLayer(() => {
				const current = this.getLayer(sceneId, layer.id);
				if (current?.layerType !== 'transform') throw new Error('Transform not found');
				return current;
			}, {
				resolution: renderResolution,
				fallbackOutput: { kind: 'uniform', value: [0, 0, 0, 0] } as TimelineImage,
				createLayer: (entry, childClipId) => this.createTimelineLayer(entry, childClipId, [...layerPath.slice(0, -1), entry.id], sceneBaseResolution, sceneId),
				getLayerVersion: (entry, childClipId) => this.getLayerVersion(sceneId, entry, childClipId),
			});
		}
		if (layer.layerType === 'group') {
			return createGroupTimelineLayer(() => {
				const current = this.getLayer(sceneId, layer.id);
				if (current?.layerType !== 'group') throw new Error('Group not found');
				return current;
			}, {
				device: this.gpuDevice,
				vertex: this.defaultVertexShaderModule,
				resolution: renderResolution,
				format: this.staticOptions.intermediateTextureFormat,
				onCompositing: this.createCompositingObserver(sceneId, layer.id, null, renderResolution),
				// グループは別Sceneの配置ではない。同じSceneの子レイヤーは従来どおり
				// [Scene配置の経路, レイヤーID]で状態を通知し、詳細パネルから参照できるようにする。
				createLayer: (entry, childClipId) => this.createTimelineLayer(entry, childClipId, [...layerPath.slice(0, -1), entry.id], sceneBaseResolution, sceneId),
				getLayerVersion: (entry, childClipId) => this.getLayerVersion(sceneId, entry, childClipId),
			});
		}
		if (clipId == null) throw new Error('Clip is required');
		const onCompositing = this.createCompositingObserver(sceneId, layer.id, clipId, renderResolution);
		// レイヤーの種類の解釈とリソース解決は、タイムライン制御の外側で行う。
		switch (layer.layerType) {
			case 'voicevox':
				return createVoicevoxTimelineLayer(layer, {
					onCompositing,
					// 再生時・書き出し時に渡された一覧を使い、音声長が更新されたら既存レイヤーも参照し直す。
					resolveSpeech: request => this.resolveSpeech(request),
					device: this.gpuDevice,
					vertex: this.defaultVertexShaderModule,
					resolution: renderResolution,
					format: this.staticOptions.intermediateTextureFormat,
					fontFileSource: this.resources.assets.find(asset => asset.id === layer.subtitleStaticSettings.font && asset.fileDataType.startsWith('font/'))?.fileData ?? null,
				});
			case 'text':
				return createTextTimelineLayer(layer, {
					onCompositing,
					device: this.gpuDevice,
					vertex: this.defaultVertexShaderModule,
					resolution: renderResolution,
					format: this.staticOptions.intermediateTextureFormat,
					fontFileSource: this.resources.assets.find(asset => asset.id === layer.textStaticSettings.font && asset.fileDataType.startsWith('font/'))?.fileData ?? null,
				});
			case 'shape':
				return createShapeTimelineLayer(layer, {
					onCompositing,
					device: this.gpuDevice,
					vertex: this.defaultVertexShaderModule,
					resolution: renderResolution,
					format: this.staticOptions.intermediateTextureFormat,
				});
			case 'effect': {
				const definition = this.effectDefinitions[layer.effectId];
				const implementation = this.effectImplementations[layer.effectId];
				if (!definition || !implementation) throw new Error(`Effect not found: ${layer.effectId}`);
				const source = this.createLayerStatusSource(layer.id, clipId, layerPath);
				return createEffectTimelineLayer(layer, definition, implementation, {
					onCompositing,
					wgpu: {
						device: this.gpuDevice,
						defaultVertexShaderModule: this.defaultVertexShaderModule,
						enable32bitDataTextures: this.staticOptions.enable32bitDataTextures,
						intermediateTextureFormat: this.staticOptions.intermediateTextureFormat,
					},
					fallbackTexture: this.fallbackTexture,
					resolution: renderResolution,
					resolutionScale: this.dynamicOptions.resolutionScale,
					assets: this.resources.assets,
					assetTextures: this.assetTextures.textures,
					getAudioInput: (binding, time, isExport) => this.audioInputs.getInput(this.evaluationScenes, sceneId, layer.id, binding, time, isExport),
					onState: status => this.emit('ev', { type: 'effectLayerState', ctx: { source, status } }),
				});
			}
			case 'image': {
				const clip = layer.clips.find(clip => clip.id === clipId)!;
				const texture = this.assetTextures.textures.get(clip.assetId);
				// 参照切れを透明画像として合成すると、replaceで下層まで消してしまう。
				// IDは保存したままエラーにし、Asset削除のUndoや参照画像の変更で復旧できるようにする。
				if (!texture) throw new Error(`Image asset not found: ${clip.assetId}`);
				return createImageTimelineLayer(layer, texture, {
					onCompositing,
					device: this.gpuDevice,
					vertex: this.defaultVertexShaderModule,
					resolution: renderResolution,
					format: this.staticOptions.intermediateTextureFormat,
					resolutionScale: this.dynamicOptions.resolutionScale,
				});
			}
			case 'video': {
				const clip = layer.clips.find(clip => clip.id === clipId)!;
				const asset = this.resources.assets.find(asset => asset.id === clip.assetId);
				if (!asset) throw new Error(`Video asset not found: ${clip.assetId}`);
				return createVideoTimelineLayer(layer, asset.fileData, {
					videoEnabled: clip.videoEnabled,
					reversePlayback: 'sourceInMs' in clip && clip.playbackRate < 0,
					onCompositing,
					onTiming: this.staticOptions.enableStats ? timing => {
						if (this.previewFrameTiming == null) return;
						this.previewFrameTiming.videoSampleWaitMs += timing.sampleWaitMs;
						this.previewFrameTiming.videoUploadCpuMs += timing.uploadCpuMs;
					} : null,
					device: this.gpuDevice,
					vertex: this.defaultVertexShaderModule,
					resolution: renderResolution,
					format: this.staticOptions.intermediateTextureFormat,
					resolutionScale: this.dynamicOptions.resolutionScale,
				});
			}
			case 'scene': {
				const clip = layer.clips.find(clip => clip.id === clipId)!;
				const scene = getTimelineScene(this.evaluationScenes, clip.sceneId);
				const childBaseResolution = getSceneBaseResolution(scene.resolution, this.dynamicOptions.resolution);
				return createSceneTimelineLayer(() => getTimelineScene(this.evaluationScenes, scene.id), layer, {
					onCompositing,
					device: this.gpuDevice,
					vertex: this.defaultVertexShaderModule,
					resolution: renderResolution,
					sceneResolution: resolveSceneResolution(scene.resolution, this.dynamicOptions.resolution,
						this.dynamicOptions.resolutionScale, this.gpuDevice.limits.maxTextureDimension2D),
					format: this.staticOptions.intermediateTextureFormat,
					createLayer: (entry, childClipId) => this.createTimelineLayer(entry, childClipId, [...layerPath, clipId, entry.id], childBaseResolution, scene.id),
					getLayerVersion: (entry, childClipId) => this.getLayerVersion(scene.id, entry, childClipId),
				});
			}
			case 'visualModule': {
				const visualModule = this.dynamicOptions.visualModules.find(module => module.id === layer.visualModuleId);
				if (visualModule == null) throw new Error(`Visual module not found: ${layer.visualModuleId}`);
				return this.createVisualModuleLayer(visualModule, layer, clipId, layerPath, sceneBaseResolution, sceneId);
			}
			case 'inlineVisualModule':
				return this.createVisualModuleLayer(layer.visualModule, layer, clipId, layerPath, sceneBaseResolution, sceneId);
		}
		throw new Error(`Unrecognized layer type: ${layer.layerType}`);
	}

	private createLayerStatusSource(layerId: string, clipId: string, layerPath: string[]): TimelineLayerStatusSource {
		return {
			type: 'timelineLayer',
			instanceId: `timeline:${this.nextTimelineLayerStatusId++}`,
			layerId,
			clipId,
			rootSceneId: this.dynamicOptions.sceneId!,
			layerPath,
		};
	}

	private createVisualModuleLayer(visualModule: VisualModule, layer: TimelineVisualModuleLayer | TimelineInlineVisualModuleLayer, clipId: string, layerPath: string[], sceneBaseResolution: Resolution, sceneId: string): TimelineLayerRenderer<TimelineImage> {
		const target: VisualModuleTarget = layer.layerType === 'visualModule' ? { visualModuleId: layer.visualModuleId }
			: { sceneId, inlineVisualModuleLayerId: layer.id };
		const getModule = () => findRendererVisualModule(this.dynamicOptions, target)!;
		const getLayer = () => this.getLayer(sceneId, layer.id) as TimelineVisualModuleLayer | TimelineInlineVisualModuleLayer;
		let moduleRevision = this.projectVersions.module(target).revision;
		const statusSource = this.createLayerStatusSource(layer.id, clipId, layerPath);
		const getInputResolutions = () => new Map(getModule().paramDefs.map(definition => {
			const binding = getLayer().visualModuleParamValues[definition.id];
			const isTexture = binding?.inputSource === 'lowerLayerOutput' || binding?.inputSource === 'anotherLayerOutput'
				|| (binding == null && definition.id === getModule().primaryInputId);
			return [definition.id, isTexture ? scaleResolution(sceneBaseResolution, this.dynamicOptions.resolutionScale) : null] as const;
		}));
		const renderer = new VisualModuleRenderer({
			gpuDevice: this.gpuDevice,
			fallbackTexture: this.fallbackTexture,
			inputResolutions: getInputResolutions(),
			resolution: sceneBaseResolution,
			resolutionScale: this.dynamicOptions.resolutionScale,
			enable32bitDataTextures: this.staticOptions.enable32bitDataTextures,
			intermediateTextureFormat: this.staticOptions.intermediateTextureFormat,
			enableStats: false,
			timingHelper: null,
			onEffectState: (nodeId, status) => this.emit('ev', { type: 'effectState', ctx: { source: statusSource, nodeId, status } }),
			videoFrames: new Map(),
			videoFrameVersions: new Map(),
			assets: this.resources.assets,
			visualModule,
			assetTextures: this.assetTextures.textures,
			effectDefinitions: this.effectDefinitions,
			effectImplementations: this.effectImplementations,
		});
		const compositingParameters = new TimelineCompositingParameters();
		const compositor = createTimelineCompositor({
			onCompositing: this.createCompositingObserver(sceneId, layer.id, clipId, scaleResolution(sceneBaseResolution, this.dynamicOptions.resolutionScale)),
			device: this.gpuDevice,
			vertex: this.defaultVertexShaderModule,
			resolution: scaleResolution(sceneBaseResolution, this.dynamicOptions.resolutionScale),
			format: this.staticOptions.intermediateTextureFormat,
			beginPass: (encoder, descriptor) => encoder.beginRenderPass(descriptor),
		});
		const inputFrames = new Map<VisualModuleCustomParameterId, ReturnType<typeof createSceneOutput>>();
		const instance = createVisualModuleTimelineLayer(getModule, getLayer, {
			getImageInput: (input, parameterId) => {
				let inputFrame = inputFrames.get(parameterId);
				if (inputFrame == null) {
					inputFrame = createSceneOutput({
						device: this.gpuDevice,
						vertex: this.defaultVertexShaderModule,
						resolution: scaleResolution(sceneBaseResolution, this.dynamicOptions.resolutionScale),
						format: this.staticOptions.intermediateTextureFormat,
					});
					inputFrames.set(parameterId, inputFrame);
				}
				return inputFrame.renderInput(input);
			},
			getAudioInput: (binding, time, isExport) => this.audioInputs.getInput(this.evaluationScenes, sceneId, layer.id, binding, time, isExport),
			prepare: (context, signal) => renderer.prepare(context, signal),
			render: async (context, layerContext) => {
				const commandEncoder = this.gpuDevice.createCommandEncoder();
				let result: Awaited<ReturnType<TimelineLayerRenderer<TimelineImage>['evaluate']>> = { gpuTime: 0 };
				const gpuTime = 0;
				try {
					const output = renderer.render(context, commandEncoder);
					if (output != null) {
						const settings = compositingParameters.evaluate({
							time: layerContext.sceneTimeMs,
							isExport: context.isExport,
							coordinateSpace: getLayer().coordinateSpace,
							mask: getLayer().mask,
							layerMask: getLayer().layerMask,
							transformTarget: getLayer().transformTarget,
							paramValues: getLayer().compositingParamValues,
							automationGraphs: getLayer().automationGraphs,
							customParameters: layerContext.customParameters,
						});
						result = compositor.evaluate(layerContext, output, settings);
					}
				} finally {
					// 描画途中の例外でもエンコーダーと計測を完了する。
					this.gpuDevice.queue.submit([commandEncoder.finish()]);
				}
				return { ...result, gpuTime };
			},
			destroy: () => {
				compositor.dispose();
				for (const frame of inputFrames.values()) frame.dispose();
				renderer.destroy();
			},
		});
		return {
			evaluate: (context, signal) => {
				const version = this.projectVersions.module(target);
				if (version.revision !== moduleRevision) {
					const currentVisualModule = getModule();
					const preserveStaticState = version.staticResetRevision <= moduleRevision;
					if (!preserveStaticState) {
						const parameterIds = new Set(currentVisualModule.paramDefs.map(definition => definition.id));
						// 公開定義の編集では配置を維持するため、消えた入力のGPU資源をここで解放する。
						for (const [parameterId, frame] of inputFrames) {
							if (parameterIds.has(parameterId)) continue;
							frame.dispose();
							inputFrames.delete(parameterId);
						}
					}
					// 公開入力の寸法も定義変更時だけ宣言し、新しい配線と同時に計画する。
					renderer.updateVisualModule(currentVisualModule, {
						preserveStaticState,
						...(preserveStaticState ? {} : { inputResolutions: getInputResolutions() }),
					});
					moduleRevision = version.revision;
				}
				return instance.evaluate(context, signal);
			},
			destroy: () => instance.destroy(),
		};
	}

	public destroy() {
		if (this.frameCacheReportIntervalId != null) clearInterval(this.frameCacheReportIntervalId);
		this.frameCache.dispose();
		if (this.telemetryReportIntervalId != null) clearInterval(this.telemetryReportIntervalId);
		this.clearTimelineRenderers();
		this.audioInputs.dispose();
		this.assetTextures.dispose();
		this.canvasRenderer.destroy();
		this.gpuDevice?.destroy();
	}

	public recycleCpuPreviewPixels(target: CpuPreviewCanvasTarget, frameId: number, pixels: ArrayBuffer) {
		this.canvasRenderer.recycleCpuPreviewPixels(target, frameId, pixels);
	}
}

export async function createManager(options: {
	canvas: OffscreenCanvas;
	histogramCanvas: OffscreenCanvas;
	waveformHorizontalCanvas: OffscreenCanvas;
	waveformVerticalCanvas: OffscreenCanvas;
	staticOptions: TimelineRendererManagerStaticOptions;
	dynamicOptions: Partial<TimelineRendererManagerDynamicOptions>;
	resources: TimelineRendererManagerResources;
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

	let manager: TimelineRendererManager | null = null;
	let coreConfig: TimelineRendererManagerCoreConfig;
	try {
		const displayMode = options.staticOptions.previewDisplayMode ?? 'gpu';
		const createContext = (canvas: OffscreenCanvas, target: CpuPreviewCanvasTarget) => createPreviewCanvasContext(canvas, displayMode,
			frame => manager?.emit('ev', { type: 'cpuPreviewFrame', ctx: { ...frame, target } }));
		coreConfig = {
			gpuDevice: device,
			gpuContext: createContext(options.canvas, 'canvas'),
			histogramGpuContext: createContext(options.histogramCanvas, 'histogramCanvas'),
			waveformHorizontalGpuContext: createContext(options.waveformHorizontalCanvas, 'waveformHorizontalCanvas'),
			waveformVerticalGpuContext: createContext(options.waveformVerticalCanvas, 'waveformVerticalCanvas'),
			effectDefinitions: options.effectDefinitions,
			effectImplementations: options.effectImplementations,
		};
	} catch (error) {
		// Managerへ渡す前の失敗だけは、GPUDeviceを取得したこの呼び出し元が回収する。
		device.destroy();
		throw error;
	}
	manager = await TimelineRendererManager.create(coreConfig, options.staticOptions, options.resources);
	try {
		manager.updateDynamicOptions(options.dynamicOptions);
		return manager;
	} catch (error) {
		manager.destroy();
		throw error;
	}
}
