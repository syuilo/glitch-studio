import { diffEffectRegistrationSnapshots } from './effect-registration-changes.ts';
import { createProjectEffectDefinitions, type NativeEffectDefinitions } from '@gs/glitch-studio_shared/project/effects.ts';
import type { EffectDefinitions } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { NativeEffectImplementation, EffectPreparationStatus } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import type { EffectRenderTiling, EffectRenderTilingProgress } from '@gs/subsystems_effect-new_shared/effect-render-tiling.ts';
import type { ImageValueRange, ImageValueScale } from '@gs/shared/utility/image-value-scale.ts';
import type { ImageAnalysisTarget } from '@gs/shared/utility/image-analysis.ts';
import type { PreviewImageAnalysisSettings, PreviewWaveformCanvasSizes, PreviewImageAnalysisDisplaySettings } from '@gs/glitch-studio_shared/preview-image-analysis.ts';
import type { PreviewWaveformViewports } from '@gs/glitch-studio_shared/preview-waveform-viewport.ts';
import type { PreviewGamutCompressionSettings } from '@gs/glitch-studio_shared/preview-gamut-compression.ts';
import type { PreviewGamutWarningSettings } from '@gs/glitch-studio_shared/preview-gamut-warning.ts';
import type { PreviewImageSource } from '@gs/glitch-studio_shared/preview-image-source.ts';
import { isCustomNodeGraphEffectValueChange } from './project-change-policy.ts';
import type { CustomNodeGraphEffectValueChange } from './project-change-policy.ts';
import type { ProjectCustomShaderEffect } from '@gs/glitch-studio_shared/project/types.ts';
import { createTimelineLayerPublicParameterContextIndex } from '@gs/subsystems_timeline_shared/public-parameters.ts';
import type { TimelineLayerPublicParameterContext } from '@gs/subsystems_timeline_shared/public-parameters.ts';
import { createTransformTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/transform/transform-timeline-layer.ts';
import { TimelineTransformParameters } from '@gs/subsystems_timeline_shared/layers/transform/transform-parameters.ts';
import { isTimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { getTimelineRenderLayers, flattenTimelineLayers, findTimelineLayer, findTimelineLayerLocation } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { getTimelineSoloState, type TimelineLayerActivityMap } from '@gs/subsystems_timeline_shared/solo.ts';
import { createGroupTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/group/group-timeline-layer.ts';
import { createSpeechResolver } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import { getTimelineMotionBlurBoundaries, getTimelineMotionBlurCameraCuts, getTimelineMotionBlurLoops, getTimelineSampleTimes } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import { TimelineFrameRenderer } from '@gs/subsystems_timeline_renderer/timeline-frame-renderer.ts';
import { createMotionBlurAccumulator } from '@gs/subsystems_timeline_renderer/motion-blur-accumulator.ts';
import { scaleResolution, type Resolution } from '@gs/shared/resolution.ts';
import { getTimelineScene } from '@gs/subsystems_timeline_shared/scenes.ts';
import { applyRendererProjectChanges } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { getSceneBaseResolution, resolveSceneResolution } from '@gs/subsystems_timeline_shared/scene-resolution.ts';
import EventEmitter from 'eventemitter3';
import { createSceneTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/scene/scene-timeline-layer.ts';
import { createImageTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/image/image-timeline-layer.ts';
import { createEffectTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/effect/effect-timeline-layer.ts';
import { createVoicevoxTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/voicevox/voicevox-timeline-layer.ts';
import { createTextTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/text/text-timeline-layer.ts';
import { createShapeTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/shape/shape-timeline-layer.ts';
import { createSceneOutput } from '@gs/subsystems_timeline_renderer/scene-output.ts';
import { LinearImageReadback } from './linear-image-readback.ts';
import { SrgbImageReadback } from './srgb-image-readback.ts';
import { getTimelineScenesWithProjectAutomationGraphs } from '@gs/glitch-studio_shared/project/automation-graphs.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
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
import { PreviewRenderDelayMonitor } from './preview-render-delay-monitor.ts';
import { getRendererRequiredGpuFeatures } from './renderer-gpu-features.ts';
import type { CpuPreviewFrameReservation } from './cpu-preview-frame-queue.ts';
import { createPreviewCanvasContext } from './preview-canvas-context.ts';
import { createCanvasOutputConfigurator, createGpuPreviewCanvasOutputSettings, createSrgbCanvasOutputSettings } from './canvas-output.ts';
import type { CanvasOutputSettings } from './canvas-output.ts';
import type { PreviewCanvasContext, PreviewDisplayMode, CpuPreviewFrame, CpuPreviewCanvasTarget } from './preview-canvas-context.ts';
export type { PreviewDisplayMode, CpuPreviewFrame } from './preview-canvas-context.ts';
import { ProjectStateVersions } from './project-state-versions.ts';
import { AssetTextures } from './asset-textures.ts';
import { TimelineAudioInputs } from './timeline-audio-inputs.ts';
import { TimelinePreviewStatisticsCollector } from './timeline-preview-statistics.ts';
import { TimelinePreviewFrameCache } from './timeline-preview-frame-cache.ts';
import { getTimelinePreviewFrameIndex } from '@gs/glitch-studio_shared/timeline-preview-frame.ts';
import type { TimelinePreviewFrameCachePrecision, TimelinePreviewFrameCacheState, TimelinePreviewSeekMode } from '@gs/glitch-studio_shared/timeline-preview-frame.ts';
import type { TimelinePreviewCachedFrame } from './timeline-preview-frame-cache.ts';
import type { TimelinePreviewFrameTiming, TimelinePreviewStatistics } from './timeline-preview-statistics.ts';
import type { TimelineTransformObservation, TimelineTransformPreview } from '@gs/glitch-studio_shared/timeline-transform-preview.ts';
import type { TimelineCompositingObserver } from '@gs/subsystems_timeline_renderer/timeline-compositor.ts';
import type { TimelineMotionBlurCameraCuts, TimelineMotionBlurLoop } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import type { GeneratedSpeech } from '@gs/glitch-studio_shared/voicevox.ts';
import type { TimelineMotionBlurSettings } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import type { RendererProjectChange, RendererProjectState } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import type { ProjectCustomNodeGraphEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { TimelineImage } from '@gs/subsystems_timeline_renderer/timeline-image.ts';
import type { FrameScheduler } from './effect-live-preview-render-loop.ts';
import type { TimelineLayerRenderer } from '@gs/subsystems_timeline_renderer/timeline-renderer.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { TimelineScene, TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';

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
	effectRenderTiling?: EffectRenderTiling;
	/** 処理中の1件に追加できる先行数。省略時は1、0ではGPU完了まで直列に処理する。 */
	previewFramesAhead?: number;
	/** プレビュー用の容量上限。省略時・0では複製・保持・定期通知を行わない。 */
	frameCacheMaxBytes?: number;
	/** キャッシュだけの保存精度。省略時は元の形式を保持する。 */
	frameCachePrecision?: TimelinePreviewFrameCachePrecision;
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
	/** 黒・白と色域外の警告で共通に使う、表示補正前または補正後の判定画像。 */
	previewWarningImageSource: PreviewImageSource;
	/** 選択された判定画像を、判定色域・判定範囲と比較する。 */
	previewGamutWarning: PreviewGamutWarningSettings;
	/** 表示用の露出（EV）。作品内の画像・解析には適用せず、書き出しでは0を使う。 */
	previewExposure: number;
	/** sRGB環境の見え方を確認する表示専用の範囲制限。色域圧縮は一時的に迂回する。 */
	previewSrgbProof: boolean;
	/** プレビュー専用の色域圧縮。書き出しではnoneを使う。 */
	previewGamutCompression: PreviewGamutCompressionSettings;
	/** 透過非対応の出力用に、乗算済みRGBを黒背景へ合成する。 */
	opaqueOutput: boolean;
	/** 表示用背景。nullは透明出力で、書き出しではプレビュー背景を使わない。 */
	previewBackground: 'black' | 'checker' | null;
	/** 表示中のプレビューだけが、停止中の背景アニメーションを駆動する。 */
	previewActive: boolean;
	analysisValueScale: ImageValueScale;
	analysisTarget: ImageAnalysisTarget;
	analysisImageSource: PreviewImageSource;
	analysisValueRange: ImageValueRange;
	analysisPaused: boolean;
	analysisWaveformCanvasSizes: PreviewWaveformCanvasSizes | null;
	analysisWaveformViewports: PreviewWaveformViewports | null;
	analysisHistogramViewport: ImageValueRange | null;
	generatedSpeech: GeneratedSpeech[];
	customNodeGraphEffects: ProjectCustomNodeGraphEffect[];
	customShaderEffects: ProjectCustomShaderEffect[];
	timelineScenes: TimelineScene[];
	automationGraphs: AutomationGraph[];
	sceneId: string | null;
	transformObserver: TimelineTransformObservation | null;
	/** UIから送られた状態の世代。既存の更新RPCに同梱し、古い枠の採用を防ぐ。 */
	previewRevision: number;
	/** nullではプロジェクト基準fpsを使用する。露光時間とは独立したプレビューの時計。 */
	previewFps: number | null;
};

/** 素材は寿命中に固定する。Effectの登録情報はプロジェクト状態に含める。 */
export type TimelineRendererManagerResources = { assets: readonly Asset[] };

/** Managerが所有するGPU環境と、注入する描画機能。 */
export type TimelineRendererManagerCoreConfig = {
	gpuDevice: GPUDevice;
	gpuContext: PreviewCanvasContext;
	/** 出力側が指定するCanvas設定。省略時もプレビュー設定から独立した8bit sRGB。 */
	canvasOutput?: CanvasOutputSettings;
	frameScheduler?: FrameScheduler;
	histogramGpuContext?: PreviewCanvasContext;
	waveformHorizontalGpuContext?: PreviewCanvasContext;
	waveformVerticalGpuContext?: PreviewCanvasContext;
	nativeEffectDefinitions: NativeEffectDefinitions;
	nativeEffectImplementations: Readonly<Record<string, NativeEffectImplementation>>;
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
	'renderDelay': (ctx: { isDelayed: boolean; tilingProgress: EffectRenderTilingProgress | null }) => void;
	'telemetry': (ctx: TimelinePreviewStatistics) => void;
	'frameCache': (ctx: TimelinePreviewFrameCacheState) => void;
	/** 完了通知を要求した手動シークだけを、最終出力のGPU処理完了後に通知する。 */
	'frameRendered': (ctx: { requestId: number; sceneId: string | null; time: number; revision: number }) => void;
	'effectLayerState': (ctx: { source: TimelineLayerStatusSource; status: EffectPreparationStatus | null }) => void;
	'renderError': (ctx: { message: string }) => void;
	'layerTransform': (ctx: TimelineTransformPreview) => void;
};

export class TimelineRendererManager extends EventEmitter<{
	'ev': (ctx: { [K in keyof TimelineRendererManagerEvents]: { type: K; ctx: Parameters<TimelineRendererManagerEvents[K]>[0] } }[keyof TimelineRendererManagerEvents]) => void;
}> {
	private timelineRenderer: TimelineRenderer<TimelineImage, TimelineLayer>;
	private previewRenderGeneration = 0;
	private readonly previewRenderDelayMonitor = new PreviewRenderDelayMonitor((isDelayed, tilingProgress) => {
		this.emit('ev', { type: 'renderDelay', ctx: { isDelayed, tilingProgress } });
	});
	private previewFrameSequence = 0;
	private publishedPreviewFrameSequence = 0;
	private previewFrameTiming: TimelinePreviewFrameTiming | null = null;
	private previewStatistics = new TimelinePreviewStatisticsCollector();
	private telemetryReportIntervalId: ReturnType<typeof setInterval> | null = null;
	private frameRenderedRequestId: number | null = null;
	private previewSeekMode: TimelinePreviewSeekMode = 'frame';
	private frameCache: TimelinePreviewFrameCache<ReadonlyMap<string, CachedLayerTransform>>;
	private frameCacheRevision = 0;
	private readonly frameCacheReportIntervalId: ReturnType<typeof setInterval> | null = null;
	private activePreviewFrame: PreviewFrameCapture | null = null;
	private pendingCustomNodeGraphEffectValueChanges = new Map<string, CustomNodeGraphEffectValueChange>();
	private pendingCustomNodeGraphEffectValueRevision: number | null = null;
	private frameRenderer: TimelineFrameRenderer<TimelineImage>;
	private motionBlurAccumulator: ReturnType<typeof createMotionBlurAccumulator> | null = null;
	private motionBlurTiming: { boundaries: number[]; loops: TimelineMotionBlurLoop[]; cameras: TimelineMotionBlurCameraCuts[] } | null = null;
	private resolveSpeech = createSpeechResolver([]);
	private nextTimelineLayerStatusId = 0;
	private previewScheduler: TimelinePreviewScheduler;
	private gpuContext: PreviewCanvasContext;
	private configureCanvas: ReturnType<typeof createCanvasOutputConfigurator>;
	private gpuDevice: GPUDevice;
	private canvasRenderer: CanvasRenderer;
	private defaultVertexShaderModule: GPUShaderModule;
	private sceneOutput: ReturnType<typeof createSceneOutput> | null = null;
	private imageExportOutput: LinearImageReadback | SrgbImageReadback | null = null;
	private renderingResourcesReleased = false;
	private assetTextures: AssetTextures;
	private readonly resources: TimelineRendererManagerResources;
	private audioInputs: TimelineAudioInputs;
	private definitions: EffectDefinitions;
	private readonly nativeEffectDefinitions: NativeEffectDefinitions;
	private readonly nativeEffectImplementations: Readonly<Record<string, NativeEffectImplementation>>;
	private projectVersions = new ProjectStateVersions();
	private evaluationScenes: TimelineScene[] = [];
	private layerActivityBySceneId = new Map<string, TimelineLayerActivityMap>();
	private publicParameterContextsBySceneId = new Map<string, ReadonlyMap<string, TimelineLayerPublicParameterContext>>();
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
		previewWarningImageSource: 'original',
		previewGamutWarning: { enabled: false, referenceGamut: 'srgb', bounds: 'unit' },
		previewExposure: 0,
		previewSrgbProof: false,
		previewGamutCompression: { mode: 'none', customAmount: 0.5 },
		opaqueOutput: false,
		previewBackground: null,
		previewActive: false,
		analysisValueScale: 'srgb',
		analysisTarget: 'rgb',
		analysisImageSource: 'original',
		analysisValueRange: { minimum: 0, maximum: 1 },
		analysisPaused: false,
		analysisWaveformCanvasSizes: null,
		analysisWaveformViewports: null,
		analysisHistogramViewport: null,
		generatedSpeech: [],
		customNodeGraphEffects: [],
		customShaderEffects: [],
		timelineScenes: [],
		automationGraphs: [],
		sceneId: null,
		transformObserver: null,
		previewRevision: 0,
		previewFps: null,
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
		this.nativeEffectDefinitions = coreConfig.nativeEffectDefinitions;
		this.nativeEffectImplementations = coreConfig.nativeEffectImplementations;
		this.definitions = createProjectEffectDefinitions(this.dynamicOptions, this.nativeEffectDefinitions);

		const canvasOutput = coreConfig.canvasOutput ?? createSrgbCanvasOutputSettings();
		this.configureCanvas = createCanvasOutputConfigurator(this.gpuDevice, this.gpuContext, canvasOutput);
		this.configureCanvas('premultiplied');

		this.defaultVertexShaderModule = this.gpuDevice.createShaderModule({
			code: defaultVertexShaderCode,
		});
		this.frameCache = new TimelinePreviewFrameCache(this.gpuDevice, this.defaultVertexShaderModule,
			this.staticOptions.frameCacheMaxBytes ?? 0, this.staticOptions.frameCachePrecision ?? 'original');

		this.canvasRenderer = new CanvasRenderer({
			gpuDevice: this.gpuDevice,
			gpuContext: this.gpuContext,
			canvasOutput,
			enableWaveformAndHistogram: this.staticOptions.enableWaveformAndHistogram,
			histogramGpuContext: coreConfig.histogramGpuContext,
			waveformHorizontalGpuContext: coreConfig.waveformHorizontalGpuContext,
			waveformVerticalGpuContext: coreConfig.waveformVerticalGpuContext,
		});

		const camera = new TimelineSceneCamera();
		const getFallbackOutput = () => this.getSceneOutput().transparentImage;
		this.timelineRenderer = new TimelineRenderer<TimelineImage, TimelineLayer>({
			getLayerActivity: () => this.dynamicOptions.sceneId == null ? undefined : this.layerActivityBySceneId.get(this.dynamicOptions.sceneId),
			getRenderSpace: (time, isExport, referenceTime) => ({
				parent: TIMELINE_IDENTITY,
				depth: 0,
				viewport: TIMELINE_FRAME,
				camera: camera.evaluate(this.evaluationScenes.find(scene => scene.id === this.dynamicOptions.sceneId)?.layers ?? [], time, isExport,
					scaleResolution(this.sceneBaseResolution, this.dynamicOptions.resolutionScale), referenceTime?.timeMs),
			}),
			get fallbackOutput() { return getFallbackOutput(); },
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
		if (this.frameCache.enabled) this.frameCacheReportIntervalId = setInterval(() => this.reportFrameCache(), 100);
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

	private getSceneOutput() {
		return this.sceneOutput ??= createSceneOutput({ device: this.gpuDevice, vertex: this.defaultVertexShaderModule, resolution: this.renderResolution });
	}

	private presentOutput(output: TimelineImage) {
		const encoder = this.gpuDevice.createCommandEncoder();
		const texture = this.getSceneOutput().render(encoder, output);
		if (this.imageExportOutput != null) {
			this.imageExportOutput.capture(texture, encoder);
			this.gpuDevice.queue.submit([encoder.finish()]);
			return;
		}
		this.canvasRenderer.renderToCanvas(texture, encoder, this.activePreviewFrame?.time ?? null, this.previewFrameSequence);
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
		this.previewRenderDelayMonitor.clear();
		this.emit('ev', { type: 'renderError', ctx: { message } });
	}

	private clearTimelineRenderers() {
		this.previewRenderDelayMonitor.clear();
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
		if (['generatedSpeech', 'resolution', 'resolutionScale', 'customNodeGraphEffects', 'customShaderEffects', 'automationGraphs', 'timelineScenes', 'sceneId', 'previewFps'].some(key => Object.hasOwn(newOptions, key))) {
			// 描画を作り直す要求では、保留していた値も現在の状態へ反映してから切り替える。
			this.applyPendingCustomNodeGraphEffectValues();
		}
		if (Object.hasOwn(newOptions, 'previewFps') && newOptions.previewFps != null && (!Number.isFinite(newOptions.previewFps) || newOptions.previewFps <= 0)) throw new RangeError('Invalid preview FPS');
		if (newOptions.generatedSpeech) {
			this.invalidateFrameCache();
			this.frameRenderer.clear();
			this.resolveSpeech = createSpeechResolver(newOptions.generatedSpeech);
			this.audioInputs.setGeneratedSpeech(newOptions.generatedSpeech);
		}
		const replaceTimeline = ['resolution', 'resolutionScale', 'automationGraphs', 'timelineScenes', 'sceneId', 'previewFps'].some(key => Object.hasOwn(newOptions, key));
		const syncRegistrations = newOptions.customNodeGraphEffects != null || newOptions.customShaderEffects != null;
		if (syncRegistrations && !replaceTimeline) {
			const changes = diffEffectRegistrationSnapshots(this.dynamicOptions, newOptions);
			if (changes.length > 0) this.applyProjectChangesNow(changes, newOptions.previewRevision ?? this.dynamicOptions.previewRevision);
		}
		this.dynamicOptions = { ...this.dynamicOptions, ...newOptions };
		if (syncRegistrations && replaceTimeline) {
			this.definitions = createProjectEffectDefinitions(this.dynamicOptions, this.nativeEffectDefinitions);
		}
		if (Object.hasOwn(newOptions, 'timelineScenes') || Object.hasOwn(newOptions, 'automationGraphs')) this.refreshEvaluationScenes();
		this.canvasRenderer.highlightClipping = this.dynamicOptions.highlightClipping;
		this.canvasRenderer.previewWarningImageSource = this.dynamicOptions.previewWarningImageSource;
		this.canvasRenderer.previewGamutWarning = this.dynamicOptions.previewGamutWarning;
		this.canvasRenderer.previewExposure = this.dynamicOptions.previewExposure;
		this.canvasRenderer.previewSrgbProof = this.dynamicOptions.previewSrgbProof;
		this.canvasRenderer.previewGamutCompression = this.dynamicOptions.previewGamutCompression;
		this.canvasRenderer.opaqueOutput = this.dynamicOptions.opaqueOutput;
		this.canvasRenderer.previewBackground = this.dynamicOptions.previewBackground;
		this.canvasRenderer.previewActive = this.dynamicOptions.previewActive;
		if (Object.hasOwn(newOptions, 'previewActive') && !this.dynamicOptions.previewActive) this.previewRenderDelayMonitor.stop();
		// 背景合成後は不透明。背景を持たない透明書き出しだけ、Canvasのalphaも維持する。
		this.configureCanvas(this.dynamicOptions.opaqueOutput || this.dynamicOptions.previewBackground != null ? 'opaque' : 'premultiplied');
		this.canvasRenderer.analysisValueScale = this.dynamicOptions.analysisValueScale;
		this.canvasRenderer.analysisTarget = this.dynamicOptions.analysisTarget;
		this.canvasRenderer.analysisImageSource = this.dynamicOptions.analysisImageSource;
		this.canvasRenderer.analysisValueRange = this.dynamicOptions.analysisValueRange;
		this.canvasRenderer.analysisPaused = this.dynamicOptions.analysisPaused;
		this.canvasRenderer.analysisWaveformCanvasSizes = this.dynamicOptions.analysisWaveformCanvasSizes;
		this.canvasRenderer.analysisWaveformViewports = this.dynamicOptions.analysisWaveformViewports;
		this.canvasRenderer.analysisHistogramViewport = this.dynamicOptions.analysisHistogramViewport;

		// Scene選択・出力解像度のnullは解除要求なので、差分のプロパティの有無で判定する。
		// Partialの差分では省略は変更なし、明示的なnullは解除要求。値の有無ではなくown propertyで判定する。
		if (replaceTimeline) this.clearTimelineRenderers();
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
	}

	public applyProjectChanges(changes: readonly RendererProjectChange[], previewRevision = (this.pendingCustomNodeGraphEffectValueRevision ?? this.dynamicOptions.previewRevision) + 1) {
		if ((this.staticOptions.effectRenderTiling?.mode ?? 'auto') !== 'disabled' && this.activePreviewFrame != null
			&& changes.length > 0 && changes.every(isCustomNodeGraphEffectValueChange)) {
			// 呼び出し時の検証は維持し、描画中の状態はまだ変更しない。
			applyRendererProjectChanges(this.dynamicOptions, [...this.pendingCustomNodeGraphEffectValueChanges.values(), ...changes]);
			for (const change of changes) {
				const key = JSON.stringify([change.customNodeGraphEffectId, change.type, change.type === 'node' ? change.node.id : null]);
				// 同じノードの値は最新だけ残す。Custom Node Graph Effect全体の更新と混在しても
				// 最後に届いたスナップショットが後から適用されるよう、順序も更新する。
				this.pendingCustomNodeGraphEffectValueChanges.delete(key);
				this.pendingCustomNodeGraphEffectValueChanges.set(key, change);
			}
			this.pendingCustomNodeGraphEffectValueRevision = previewRevision;
			return;
		}
		const combined = [...this.pendingCustomNodeGraphEffectValueChanges.values(), ...changes];
		this.applyProjectChangesNow(combined, previewRevision);
		this.pendingCustomNodeGraphEffectValueChanges.clear();
		this.pendingCustomNodeGraphEffectValueRevision = null;
	}

	private applyPendingCustomNodeGraphEffectValues() {
		if (this.pendingCustomNodeGraphEffectValueChanges.size === 0) return;
		const changes = [...this.pendingCustomNodeGraphEffectValueChanges.values()];
		const revision = this.pendingCustomNodeGraphEffectValueRevision!;
		this.pendingCustomNodeGraphEffectValueChanges.clear();
		this.pendingCustomNodeGraphEffectValueRevision = null;
		// 待機中の最新シークを消さず、完成した旧フレームだけをキャッシュ・通知から除外する。
		this.applyProjectChangesNow(changes, revision, true);
	}

	private applyProjectChangesNow(changes: readonly RendererProjectChange[], previewRevision: number, keepPendingRender = false) {
		const next = applyRendererProjectChanges(this.dynamicOptions, changes);
		const definitions = next.customShaderEffects === this.dynamicOptions.customShaderEffects && next.customNodeGraphEffects === this.dynamicOptions.customNodeGraphEffects
			? this.definitions : createProjectEffectDefinitions(next, this.nativeEffectDefinitions);
		const changesRootScene = changes.some(change => change.type === 'scene' && change.sceneId === this.dynamicOptions.sceneId);
		const resolution = changesRootScene ? this.resolveProjectOutputResolution(next) : null;
		// 差分の検証が成功するまで公開状態を変更しない。即時反映の変更は描画を中断し、
		// 値だけの変更を完了境界から反映する場合は、待機中の描画要求を維持する。
		if (!keepPendingRender) {
			this.previewScheduler.clear();
			this.previewRenderDelayMonitor.clear();
		}
		this.invalidateFrameCache();
		this.previewRenderGeneration++;
		if (!keepPendingRender) {
			this.timelineRenderer.cancelPendingRender();
			this.frameRenderer.cancel();
		}
		this.motionBlurTiming = null;
		this.projectVersions.apply(changes, this.dynamicOptions, next);
		Object.assign(this.dynamicOptions, next);
		this.refreshEvaluationScenes();
		this.definitions = definitions;
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
		this.layerActivityBySceneId = new Map(this.evaluationScenes.map(scene => [scene.id, getTimelineSoloState(scene.layers).layers]));
		// 祖先の値変更や階層移動も環境へ反映する。レンダラーの寿命とは分けて更新し、
		// インスタンスを維持する値編集でも古い所有レイヤーを参照し続けないようにする。
		this.publicParameterContextsBySceneId = new Map(this.evaluationScenes.map(scene => [scene.id, createTimelineLayerPublicParameterContextIndex(scene.layers)]));
	}

	private getLayerPublicParameterContext(sceneId: string | null, layerId: string): TimelineLayerPublicParameterContext | null {
		return sceneId == null ? null : this.publicParameterContextsBySceneId.get(sceneId)?.get(layerId) ?? null;
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

	public resetRenderHistory() {
		this.applyPendingCustomNodeGraphEffectValues();
		this.previewRenderDelayMonitor.clear();
		// リセット前に送信したフレームの後処理で、画像キャッシュや完了通知を復活させない。
		// Schedulerの世代も進め、次の評価は旧フレームのGPU完了後に行う。
		this.previewRenderGeneration++;
		this.previewScheduler.clear();
		this.frameRenderer.clear();
		this.timelineRenderer.resetRenderHistory();
		this.frameRenderedRequestId = null;
		this.invalidateFrameCache();
		this.reportFrameCache();
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
		const layer = location != null && this.layerActivityBySceneId.get(request!.sceneId)?.get(location.layer.id)?.isOutputEnabled === true && isTimelineVisualLayer(location.layer) ? location.layer : null;
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
		// 非表示へ切り替えた後も、Schedulerに残っていた要求は実行され得る。
		// その要求で停止済みの監視タイマーを再開しない。
		if (this.dynamicOptions.previewActive) this.previewRenderDelayMonitor.beginFrame(capture);
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
					this.canvasRenderer.renderToCanvas(cached.texture, encoder, time, sequence);
					this.submitPreviewOutput(encoder);
				} else {
					await this.renderFrame(time, false, this.staticOptions.timelineFps, timeDelta);
				}
				prepared = true;
			} finally {
				// 送信後は設定された上限まで次の準備を許可する。GPU完了を待つこの関数の寿命と、
				// CPU側の評価で使う参照の寿命を分け、前フレームの後始末で次の参照を消さない。
				if (this.activePreviewFrame === capture) {
					this.activePreviewFrame = null;
					this.applyPendingCustomNodeGraphEffectValues();
				}
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
				// 表示用画像の完了で解除し、キャッシュ登録等の後処理は待機表示に含めない。
				this.previewRenderDelayMonitor.completeFrame(capture);
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
						publicParameters: this.getLayerPublicParameterContext(sceneId, layer.id),
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
			// 値の保留を完了境界で反映した場合、Schedulerの待機要求は同じ世代に残る。
			// 旧内容の失敗でその要求まで取り消さず、最新の値で再試行させる。
			return generation !== this.previewRenderGeneration;
		} finally {
			this.previewRenderDelayMonitor.completeFrame(capture);
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
				publicParameters: this.getLayerPublicParameterContext(sceneId, entry.id),
			});
			const settings = evaluate(layer);
			const cameraEvaluation = capture?.cameraEvaluation ?? {
				camera: this.transformPreviewCamera.evaluate(this.evaluationScenes.find(scene => scene.id === sceneId)?.layers ?? [], time, false, sceneSize),
			};
			if (capture != null) capture.cameraEvaluation = cameraEvaluation;
			const parent = getTimelinePreviewParent(location.ancestors.filter(parent => parent.layerType === 'group' || parent.layerType === 'transform').map(parent => parent.layerType === 'transform'
				? { transform: this.transformPreviewContainerParameters.evaluate(parent.transformParamValues, parent.automationGraphs, time, false, this.getLayerPublicParameterContext(sceneId, parent.id)) }
				: { settings: evaluate(parent), compositingMode: parent.compositingMode }), settings, sceneSize,
			{
				parent: TIMELINE_IDENTITY,
				depth: 0,
				camera: cameraEvaluation.camera,
				viewport: TIMELINE_FRAME,
			});
			// 範囲モードのハンドルは出力の物理解像度・比率に依存しないSceneの矩形を操作する。
			preview.geometry = parent && invertTimelineAffine(parent) ? { sourceSize: settings.transformTarget === 'region' ? sceneSize : timelineImageFrame(source), sceneSize, transform: settings } : null;
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

	/** 専用の書き出しManagerで呼ぶ。戻り値の画像は呼び出し側がdisposeする。 */
	public async renderTimelineLinearFrame(time: number, signal: AbortSignal): Promise<LinearImageReadback> {
		const { width, height } = this.renderResolution;
		return this.renderTimelineImageFrame(() => new LinearImageReadback(this.gpuDevice, width, height), time, signal);
	}

	/** 表示用Canvasを経由せず、未乗算のsRGB画素をブロックで読み戻す。 */
	public async renderTimelineSrgbFrame(time: number, signal: AbortSignal): Promise<SrgbImageReadback> {
		const { width, height } = this.renderResolution;
		return this.renderTimelineImageFrame(() => new SrgbImageReadback(this.gpuDevice, width, height), time, signal);
	}

	private async renderTimelineImageFrame<T extends LinearImageReadback | SrgbImageReadback>(createOutput: () => T, time: number, signal: AbortSignal): Promise<T> {
		if (this.imageExportOutput != null) throw new Error('An image frame export is already running.');
		signal.throwIfAborted();
		const output = createOutput();
		this.imageExportOutput = output;
		try {
			signal.throwIfAborted();
			// 通常の静止画と同じ描画・モーションブラー・IS_EXPORT評価を使う。
			await this.renderFrame(time, true);
			signal.throwIfAborted();
			return output;
		} catch (error) {
			output.dispose();
			throw error;
		} finally {
			this.imageExportOutput = null;
		}
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
		return this.dynamicOptions.sceneId == null ? [] : getTimelineRenderLayers(getTimelineScene(this.evaluationScenes, this.dynamicOptions.sceneId).layers, this.layerActivityBySceneId.get(this.dynamicOptions.sceneId));
	}

	private createTimelineLayer(layer: TimelineLayer, clipId: string | null, layerPath: string[], sceneBaseResolution: Resolution, sceneId = this.dynamicOptions.sceneId!): TimelineLayerRenderer<TimelineImage> {
		const renderer = this.createTimelineLayerRenderer(layer, clipId, layerPath, sceneBaseResolution, sceneId);
		const publicParameters = () => this.getLayerPublicParameterContext(sceneId, layer.id);
		return {
			...renderer,
			evaluate: (context, signal) => renderer.evaluate({ ...context, publicParameters: publicParameters() }, signal),
			createChildren: renderer.createChildren == null ? undefined : (context, options) => renderer.createChildren!({ ...context, publicParameters: publicParameters() }, options),
		};
	}

	private createTimelineLayerRenderer(layer: TimelineLayer, clipId: string | null, layerPath: string[], sceneBaseResolution: Resolution, sceneId = this.dynamicOptions.sceneId!): TimelineLayerRenderer<TimelineImage> {
		const renderResolution = scaleResolution(sceneBaseResolution, this.dynamicOptions.resolutionScale);
		if (layer.layerType === 'transform') {
			const background = createSceneOutput({ device: this.gpuDevice, vertex: this.defaultVertexShaderModule, resolution: renderResolution });
			const transform = createTransformTimelineLayer(() => {
				const current = this.getLayer(sceneId, layer.id);
				if (current?.layerType !== 'transform') throw new Error('Transform not found');
				return current;
			}, {
				resolution: renderResolution,
				get fallbackOutput() { return background.transparentImage; },
				createLayer: (entry, childClipId) => this.createTimelineLayer(entry, childClipId, [...layerPath.slice(0, -1), entry.id], sceneBaseResolution, sceneId),
				getLayerVersion: (entry, childClipId) => this.getLayerVersion(sceneId, entry, childClipId),
			});
			return { ...transform, destroy() { transform.destroy(); background.dispose(); } };
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
					fontFileSource: this.resources.assets.find(asset => asset.id === layer.subtitleStaticSettings.font && asset.fileDataType.startsWith('font/'))?.fileData ?? null,
				});
			case 'text':
				return createTextTimelineLayer(layer, {
					onCompositing,
					device: this.gpuDevice,
					vertex: this.defaultVertexShaderModule,
					resolution: renderResolution,
					fontFileSource: this.resources.assets.find(asset => asset.id === layer.textStaticSettings.font && asset.fileDataType.startsWith('font/'))?.fileData ?? null,
				});
			case 'shape':
				return createShapeTimelineLayer(layer, {
					onCompositing,
					device: this.gpuDevice,
					vertex: this.defaultVertexShaderModule,
					resolution: renderResolution,
				});
			case 'effect': {
				const source = this.createLayerStatusSource(layer.id, clipId, layerPath);
				// 配線と入力種別は固定し、通常の値編集だけは次の評価で最新の配置から読む。
				let scenes = this.evaluationScenes;
				let currentLayer = layer;
				const readValues = () => {
					if (scenes !== this.evaluationScenes) {
						scenes = this.evaluationScenes;
						const current = this.getLayer(sceneId, layer.id);
						if (current?.layerType === 'effect') currentLayer = current;
					}
					return currentLayer.effectParamValues;
				};
				let active = true;
				let previousStatus: EffectPreparationStatus['type'] | null = null;
				const renderer = createEffectTimelineLayer({
					...layer,
					get effectParamValues() { return readValues(); },
				}, {
					definitions: this.definitions,
					getNativeEffectImplementation: id => this.nativeEffectImplementations[id],
					tiling: this.staticOptions.effectRenderTiling ?? { mode: 'auto' },
					onCompositing,
					wgpu: {
						device: this.gpuDevice,
						defaultVertexShaderModule: this.defaultVertexShaderModule,
						enable32bitDataTextures: this.staticOptions.enable32bitDataTextures,
					},
					sceneBaseResolution,
					resolutionScale: this.dynamicOptions.resolutionScale,
					resources: { assets: this.resources.assets, assetTextures: this.assetTextures.textures },
					getAudioInput: (binding, time, isExport) => this.audioInputs.getInput(this.evaluationScenes, sceneId, layer.id, binding, time, isExport),
					onPreparationStatus: status => {
						if (!active || (previousStatus === status.type && status.type !== 'error')) return;
						previousStatus = status.type;
						this.emit('ev', { type: 'effectLayerState', ctx: { source, status } });
					},
					onTilingProgress: progress => {
						if (this.activePreviewFrame != null) this.previewRenderDelayMonitor.updateTilingProgress(this.activePreviewFrame, progress);
					},
				});
				return { ...renderer, destroy: () => {
					active = false;
					renderer.destroy();
					this.emit('ev', { type: 'effectLayerState', ctx: { source, status: null } });
				} };
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
					createLayer: (entry, childClipId) => this.createTimelineLayer(entry, childClipId, [...layerPath, clipId, entry.id], childBaseResolution, scene.id),
					getLayerVersion: (entry, childClipId) => this.getLayerVersion(scene.id, entry, childClipId),
				});
			}
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

	/** 最後の描画後に呼ぶ。返却済みの書き出し画像はDeviceを借用し、読み戻しを続ける。 */
	public releaseRenderingResources(): void {
		if (this.renderingResourcesReleased) return;
		this.renderingResourcesReleased = true;
		this.previewRenderDelayMonitor.stop();
		this.pendingCustomNodeGraphEffectValueChanges.clear();
		this.pendingCustomNodeGraphEffectValueRevision = null;
		if (this.frameCacheReportIntervalId != null) clearInterval(this.frameCacheReportIntervalId);
		this.frameCache.dispose();
		if (this.telemetryReportIntervalId != null) clearInterval(this.telemetryReportIntervalId);
		this.clearTimelineRenderers();
		this.audioInputs.dispose();
		this.assetTextures.dispose();
		this.canvasRenderer.destroy();
	}

	public destroy() {
		this.releaseRenderingResources();
		this.gpuDevice?.destroy();
	}

	public setHighResolutionImageAnalysis(enabled: boolean, settings: PreviewImageAnalysisSettings) {
		return this.canvasRenderer.setHighResolutionImageAnalysis(enabled, settings);
	}

	public capturePreview(maximumSize: number, time: number) {
		const captured = this.canvasRenderer.captureNextPreviewFrame(maximumSize, this.previewFrameSequence);
		void this.renderTimelineAt(time).catch(() => this.canvasRenderer.clear());
		return captured;
	}

	public async setImageAnalysisDisplay(settings: PreviewImageAnalysisDisplaySettings, refresh: boolean) {
		// 表示領域の変更では描画内容・キャッシュ・実行中のフレームを無効化しない。
		this.dynamicOptions.analysisWaveformCanvasSizes = settings.waveformCanvasSizes;
		this.canvasRenderer.analysisWaveformCanvasSizes = settings.waveformCanvasSizes;
		this.dynamicOptions.analysisWaveformViewports = settings.waveformViewports;
		this.canvasRenderer.analysisWaveformViewports = settings.waveformViewports;
		this.dynamicOptions.analysisHistogramViewport = settings.histogramViewport;
		this.canvasRenderer.analysisHistogramViewport = settings.histogramViewport;
		if (refresh) await this.canvasRenderer.refreshImageAnalysis();
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
	nativeEffectDefinitions: NativeEffectDefinitions;
	nativeEffectImplementations: Readonly<Record<string, NativeEffectImplementation>>;
}) {
	const adapter = await navigator.gpu?.requestAdapter({
		powerPreference: 'high-performance',
	});

	const device = await adapter?.requestDevice({
		requiredFeatures: getRendererRequiredGpuFeatures(adapter, options.staticOptions),
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
			canvasOutput: displayMode === 'gpu' ? createGpuPreviewCanvasOutputSettings() : createSrgbCanvasOutputSettings(),
			histogramGpuContext: createContext(options.histogramCanvas, 'histogramCanvas'),
			waveformHorizontalGpuContext: createContext(options.waveformHorizontalCanvas, 'waveformHorizontalCanvas'),
			waveformVerticalGpuContext: createContext(options.waveformVerticalCanvas, 'waveformVerticalCanvas'),
			nativeEffectDefinitions: options.nativeEffectDefinitions,
			nativeEffectImplementations: options.nativeEffectImplementations,
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
