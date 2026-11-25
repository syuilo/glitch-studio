import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { createProjectEffectDefinitions, type NativeEffectDefinitions } from '@gs/glitch-studio_shared/project/effects.ts';
import { createEffectInstance } from '@gs/subsystems_effect_renderer/create-effect-instance.ts';
import { resolveEffectSource, type EffectDefinitions, type EffectSource } from '@gs/subsystems_effect_shared/effect-source.ts';
import { normalizedToSpatialCoordinates } from '@gs/shared/spatial-coordinate.ts';
import { scaleResolution, type Resolution } from '@gs/shared/resolution.ts';
import { applyRendererProjectChanges, isEffectLivePreviewProjectChange } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import { genId } from '@gs/shared/utility/id.ts';
import EventEmitter from 'eventemitter3';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { createEffectLivePreviewInputs, type EffectLivePreviewParameters } from './effect-live-preview-inputs.ts';
import { PendingNodesEffectValues } from './pending-nodes-effect-values.ts';
import { isNodesEffectValueChange } from './project-change-policy.ts';
import { changedEffectReferences, diffEffectRegistrationSnapshots } from './effect-registration-changes.ts';
import { browserFrameScheduler, EffectLivePreviewRenderLoop } from './effect-live-preview-render-loop.ts';
import { AssetTextures } from './asset-textures.ts';
import { EffectLivePreviewAudio, EffectLivePreviewAudioCapture } from './effect-live-preview-audio.ts';
import { EffectLivePreviewImage, type EffectLivePreviewImageSource } from './effect-live-preview-image.ts';
import { NonNegativeRollingAverage } from './utility/NonNegativeRollingAverage.ts';
import { GpuMemoryTracker } from './utility/GpuMemoryTracker.ts';
import { CanvasRenderer } from './canvas-renderer.ts';
import { PreviewRenderDelayMonitor } from './preview-render-delay-monitor.ts';
import { getRendererRequiredGpuFeatures } from './renderer-gpu-features.ts';
import { createPreviewCanvasContext } from './preview-canvas-context.ts';
import { createCanvasOutputConfigurator, createGpuPreviewCanvasOutputSettings, createSrgbCanvasOutputSettings } from './canvas-output.ts';
import type { ProjectCustomShaderEffect, ProjectNodesEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { PreviewImageSource } from '@gs/glitch-studio_shared/preview-image-source.ts';
import type { PreviewGamutWarningSettings } from '@gs/glitch-studio_shared/preview-gamut-warning.ts';
import type { PreviewGamutCompressionSettings } from '@gs/glitch-studio_shared/preview-gamut-compression.ts';
import type { PreviewWaveformViewports } from '@gs/glitch-studio_shared/preview-waveform-viewport.ts';
import type { PreviewImageAnalysisSettings, PreviewWaveformCanvasSizes, PreviewImageAnalysisDisplaySettings } from '@gs/glitch-studio_shared/preview-image-analysis.ts';
import type { ImageAnalysisTarget } from '@gs/shared/utility/image-analysis.ts';
import type { ImageValueRange, ImageValueScale } from '@gs/shared/utility/image-value-scale.ts';
import type { EffectRenderTiling, EffectRenderTilingProgress } from '@gs/subsystems_effect_shared/effect-render-tiling.ts';
import type { StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { EffectInstance, EffectFrameContext, EffectPreparationStatus, NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type { CanvasOutputSettings } from './canvas-output.ts';
import type { PreviewCanvasContext, PreviewDisplayMode, CpuPreviewFrame, CpuPreviewCanvasTarget } from './preview-canvas-context.ts';
import type { FrameScheduler, EffectLivePreviewFrameTiming } from './effect-live-preview-render-loop.ts';
import type { RendererProjectChange } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { Asset } from '@gs/shared/types.ts';

/**
 * 初期化時に決まっている必要がある設定情報
 */
export type EffectLivePreviewManagerStaticOptions = {
	previewDisplayMode?: PreviewDisplayMode;
	enable32bitDataTextures: boolean;
	effectRenderTiling?: EffectRenderTiling;
	enableStats: boolean;
	/** プレビュー用の波形・ヒストグラムのGPU処理を有効にする。 */
	enableWaveformAndHistogram: boolean;
};

/**
 * 初期化後に変更可能な設定情報
 */
export type EffectLivePreviewManagerDynamicOptions = {
	resolution: Resolution;
	/** プレビューの計算倍率。書き出しは1を使う。 */
	resolutionScale: number;
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
	effectLivePreviewTimeFactor: number;
	/** Effect Live Preview専用の描画頻度上限。タイムラインには適用しない。 */
	fpsLimit: number | null;
	nodesEffects: ProjectNodesEffect[];
	customShaderEffects: ProjectCustomShaderEffect[];
	automationGraphs: AutomationGraph[];
};

/** 素材一覧は寿命中に固定する。Effectの登録情報はプロジェクト状態に含める。 */
export type EffectLivePreviewManagerResources = { assets: readonly Asset[] };

/** Managerが所有するGPU環境と、注入する描画機能。 */
export type EffectLivePreviewManagerCoreConfig = {
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

/**
 * 出力は配置の寿命中固定する。省略時は主出力、続いて定義順の先頭を使用する。
 * 指定したポートがなくなった間は透明を表示し、同じIDが復元されたらその出力を使う。
 */
export type EffectLivePreviewPlacement = {
	effectSource: EffectSource;
	outputPort?: string;
	params?: EffectLivePreviewParameters;
	staticSettings?: StaticSettingValues;
	/** 配置ごとの描画コンテキスト寸法。省略時はプロジェクトの解像度とプレビュー倍率に従う。 */
	customResolution?: Resolution | null;
};

export type EffectLivePreviewStatusSource = { type: 'effectLivePreview'; instanceId: string };

export type EffectLivePreviewManagerEvents = {
	'cpuPreviewFrame': (ctx: CpuPreviewFrame) => void;
	'renderDelay': (ctx: { instanceId: string | null; isDelayed: boolean; tilingProgress: EffectRenderTilingProgress | null }) => void;
	'outputResolution': (ctx: Resolution) => void;
	'effectState': (ctx: { source: EffectLivePreviewStatusSource; status: EffectPreparationStatus | null }) => void;
	'renderError': (ctx: { message: string }) => void;
	'telemetry': (ctx: { fpsAverage: number; gpuAverageFast: number; gpuAverageMedium: number; gpuAverageSlow: number; }) => void;
	'gpuMemory': (ctx: { usage: { total: number; textures: number; buffers: number; } }) => void;
};

export class EffectLivePreviewManager extends EventEmitter<{
	'ev': (ctx: { [K in keyof EffectLivePreviewManagerEvents]: { type: K; ctx: Parameters<EffectLivePreviewManagerEvents[K]>[0] } }[keyof EffectLivePreviewManagerEvents]) => void;
}> {
	private previewTiledFrameController: AbortController | null = null;
	// undefinedは保留なし、nullは入力を解除する更新。
	private pendingPreviewImage: EffectLivePreviewImageSource | undefined;
	private previewRenderGeneration = 0;
	private historyGeneration = 0;
	private gpuContext: PreviewCanvasContext;
	private configureCanvas: ReturnType<typeof createCanvasOutputConfigurator>;
	private skippedFrameTimeDelta = 0;
	private skippedFrameRealTimeDelta = 0;
	private gpuDevice: GPUDevice;
	private canvasRenderer: CanvasRenderer;
	private readonly vertex: GPUShaderModule;
	private transparentTexture: GPUTexture | null = null;
	private frameScheduler: FrameScheduler;
	private effectLivePreviewRenderLoop: EffectLivePreviewRenderLoop;
	private placement: EffectLivePreviewPlacement | null = null;
	private activeEffect: {
		lifetime: AbortController;
		ready: Promise<EffectInstance>;
		instance: EffectInstance | null;
		port: string | null;
		inputs: ReturnType<typeof createEffectLivePreviewInputs>;
		pendingValues: PendingNodesEffectValues;
		gpuTiming: {
			frameTimes: WeakMap<EffectFrameContext, Promise<number | null>>;
			pending: Promise<void>;
		} | null;
	} | null = null;
	private readonly previewRenderDelayMonitor = new PreviewRenderDelayMonitor((isDelayed, tilingProgress) => {
		this.emit('ev', { type: 'renderDelay', ctx: { instanceId: this.effectLivePreviewStatusInstanceId, isDelayed, tilingProgress } });
	});
	private effectLivePreviewStatusInstanceId: string | null = null;
	private assetTextures: AssetTextures;
	private readonly resources: EffectLivePreviewManagerResources;
	private readonly previewImage: EffectLivePreviewImage;
	private previewAudio: EffectLivePreviewAudio | null = null;
	private previewAudioCapture: EffectLivePreviewAudioCapture | null = null;
	private previewAudioPosition = 0;
	private previewAudioGeneration = 0;
	private pointerPosition: { x: number; y: number } = { x: -99999, y: -99999 };
	private pointerPositionPrev: { x: number; y: number } = { x: -99999, y: -99999 };
	private clicks: { x: number; y: number, time: number }[] = [];
	private definitions: EffectDefinitions;
	private readonly nativeEffectDefinitions: NativeEffectDefinitions;
	private readonly nativeEffectImplementations: Readonly<Record<string, NativeEffectImplementation>>;
	private gpuAverageFast = new NonNegativeRollingAverage(10);
	private gpuAverageMedium = new NonNegativeRollingAverage(100);
	private gpuAverageSlow = new NonNegativeRollingAverage(1000);
	private fpsAverage = new NonNegativeRollingAverage(30);
	private telemetryReportIntervalId: ReturnType<typeof setInterval> | null = null;
	private gpuMemoryReportIntervalId: ReturnType<typeof setInterval> | null = null;
	private displayedResolution: Resolution | null = null;

	private readonly staticOptions: EffectLivePreviewManagerStaticOptions;
	private dynamicOptions: EffectLivePreviewManagerDynamicOptions = {
		resolution: { width: 1, height: 1 },
		resolutionScale: 1,
		highlightClipping: false,
		previewWarningImageSource: 'original',
		previewGamutWarning: { enabled: false, referenceGamut: 'srgb', bounds: 'unit' },
		previewExposure: 0,
		previewSrgbProof: false,
		previewGamutCompression: { mode: 'none', customAmount: 0.5 },
		effectLivePreviewTimeFactor: 1.0,
		fpsLimit: null,
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
		nodesEffects: [],
		customShaderEffects: [],
		automationGraphs: [],
	};

	private constructor(coreConfig: EffectLivePreviewManagerCoreConfig, staticOptions: EffectLivePreviewManagerStaticOptions, resources: EffectLivePreviewManagerResources) {
		super();

		this.staticOptions = { ...staticOptions };
		this.resources = resources;

		this.frameScheduler = coreConfig.frameScheduler ?? browserFrameScheduler;
		this.effectLivePreviewRenderLoop = new EffectLivePreviewRenderLoop({
			scheduler: this.frameScheduler,
			onFrame: timing => this.renderEffectLivePreviewFrame(timing).catch(error => {
				this.reportRenderError(error instanceof Error ? error.message : String(error));
			}),
			onSkippedFrame: timing => {
				this.skippedFrameTimeDelta += timing.timeDelta;
				this.skippedFrameRealTimeDelta += timing.realTimeDelta;
			},
			fpsLimit: this.dynamicOptions.fpsLimit,
			timeFactor: this.dynamicOptions.effectLivePreviewTimeFactor,
		});
		this.gpuDevice = coreConfig.gpuDevice;
		this.previewImage = new EffectLivePreviewImage(this.gpuDevice);
		this.gpuContext = coreConfig.gpuContext;
		this.nativeEffectDefinitions = coreConfig.nativeEffectDefinitions;
		this.nativeEffectImplementations = coreConfig.nativeEffectImplementations;
		this.definitions = createProjectEffectDefinitions(this.dynamicOptions, this.nativeEffectDefinitions);

		const gpuMemory = this.staticOptions.enableStats ? new GpuMemoryTracker(this.gpuDevice) : null;

		const canvasOutput = coreConfig.canvasOutput ?? createSrgbCanvasOutputSettings();
		this.configureCanvas = createCanvasOutputConfigurator(this.gpuDevice, this.gpuContext, canvasOutput);
		this.configureCanvas('premultiplied');

		this.vertex = this.gpuDevice.createShaderModule({ code: vertexCode });

		this.canvasRenderer = new CanvasRenderer({
			gpuDevice: this.gpuDevice,
			gpuContext: this.gpuContext,
			canvasOutput,
			enableWaveformAndHistogram: this.staticOptions.enableWaveformAndHistogram,
			histogramGpuContext: coreConfig.histogramGpuContext,
			waveformHorizontalGpuContext: coreConfig.waveformHorizontalGpuContext,
			waveformVerticalGpuContext: coreConfig.waveformVerticalGpuContext,
		});

		if (this.staticOptions.enableStats) this.telemetryReportIntervalId = setInterval(() => {
			this.emit('ev', {
				type: 'telemetry',
				ctx: {
					fpsAverage: this.fpsAverage.get(),
					gpuAverageFast: this.gpuAverageFast.get(),
					gpuAverageMedium: this.gpuAverageMedium.get(),
					gpuAverageSlow: this.gpuAverageSlow.get(),
				},
			});
		}, 100);

		if (gpuMemory != null) this.gpuMemoryReportIntervalId = setInterval(() => {
			this.emit('ev', { type: 'gpuMemory', ctx: { usage: gpuMemory.getUsage() } });
		}, 1000);
		this.assetTextures = new AssetTextures(this.gpuDevice, resources.assets);
	}

	/** 準備済みのManagerだけを返す。渡されたGPUDeviceは、生成失敗・中断時にもここで解放する。 */
	public static async create(coreConfig: EffectLivePreviewManagerCoreConfig, staticOptions: EffectLivePreviewManagerStaticOptions,
		resources: EffectLivePreviewManagerResources, signal?: AbortSignal): Promise<EffectLivePreviewManager> {
		let manager: EffectLivePreviewManager | null = null;
		try {
			signal?.throwIfAborted();
			manager = new EffectLivePreviewManager(coreConfig, staticOptions, resources);
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

	private reportRenderError(message: string) {
		this.previewRenderDelayMonitor.clear();
		this.emit('ev', { type: 'renderError', ctx: { message } });
	}

	public setPreviewAudioSource(assetId: string | null) {
		const asset = assetId == null ? null : this.resources.assets.find(candidate => candidate.id === assetId);
		this.previewTiledFrameController?.abort();
		this.previewAudioCapture?.dispose();
		this.previewAudioCapture = null;
		this.previewAudio?.dispose();
		this.previewAudio = asset == null ? null : new EffectLivePreviewAudio(asset.fileData);
		this.updatePreviewAudioPosition(0, true);
	}

	public attachPreviewAudioCapture(port: MessagePort) {
		this.setPreviewAudioSource(null);
		this.previewAudioCapture = new EffectLivePreviewAudioCapture(port, this.previewAudioGeneration);
	}

	public updatePreviewAudioPosition(seconds: number, discontinuity: boolean) {
		this.previewAudioPosition = seconds;
		if (discontinuity) this.previewAudioGeneration++;
	}

	public updatePreviewImage(source: EffectLivePreviewImageSource) {
		if (this.previewTiledFrameController != null) {
			// 描画中のテクスチャは借用中。次の描画までに届いた画像は最新の1枚だけ保持する。
			if (this.pendingPreviewImage?.kind === 'frame') this.pendingPreviewImage.frame.close();
			this.pendingPreviewImage = source;
			return;
		}
		const frame = source?.kind === 'frame' ? source.frame : null;
		const assetTexture = source?.kind === 'asset' ? this.assetTextures.textures.get(source.assetId) ?? null : null;
		if (this.previewImage.update(frame, assetTexture) && this.activeEffect?.inputs.usesImage === true) this.initializePlacement();
	}

	public updatePointerPosition(newPointerPosition: { x: number; y: number }) {
		this.pointerPosition = newPointerPosition;
	}

	public click(pointerPosition: { x: number; y: number }) {
		this.clicks.unshift({ ...pointerPosition, time: this.effectLivePreviewRenderLoop.getCurrentTime() });
		if (this.clicks.length > 16) this.clicks.pop();
	}

	// (非workerで)呼び出すときは値を独立した参照にすること！ パフォーマンス上の理由でこちら側ではdeepCloneしません
	public updateDynamicOptions(newOptions: Partial<EffectLivePreviewManagerDynamicOptions>) {
		const previous = this.dynamicOptions;
		this.dynamicOptions = { ...previous, ...newOptions };
		const contextResolutionChanged = this.placement?.customResolution == null
			&& (Object.hasOwn(newOptions, 'resolution') || Object.hasOwn(newOptions, 'resolutionScale'));
		let reinitialize = contextResolutionChanged;
		if (Object.hasOwn(newOptions, 'nodesEffects') || Object.hasOwn(newOptions, 'customShaderEffects')) {
			this.definitions = createProjectEffectDefinitions(this.dynamicOptions, this.nativeEffectDefinitions);
			if (!reinitialize && this.placement != null) {
				const changes = diffEffectRegistrationSnapshots(previous, newOptions);
				reinitialize = changedEffectReferences(changes, this.dynamicOptions)?.(this.placement.effectSource) === true;
			}
		}
		this.canvasRenderer.highlightClipping = this.dynamicOptions.highlightClipping;
		this.canvasRenderer.previewWarningImageSource = this.dynamicOptions.previewWarningImageSource;
		this.canvasRenderer.previewGamutWarning = this.dynamicOptions.previewGamutWarning;
		this.canvasRenderer.previewExposure = this.dynamicOptions.previewExposure;
		this.canvasRenderer.previewSrgbProof = this.dynamicOptions.previewSrgbProof;
		this.canvasRenderer.previewGamutCompression = this.dynamicOptions.previewGamutCompression;
		this.canvasRenderer.opaqueOutput = this.dynamicOptions.opaqueOutput;
		this.canvasRenderer.previewBackground = this.dynamicOptions.previewBackground;
		this.canvasRenderer.previewActive = this.dynamicOptions.previewActive;
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

		// Partialの差分では省略は変更なし、明示的なnullは解除要求。値の有無ではなくown propertyで判定する。
		if (contextResolutionChanged) {
			this.updateCanvasResolution(scaleResolution(this.dynamicOptions.resolution, this.dynamicOptions.resolutionScale));
		}
		// nullはFPS制限の解除なので、値ではなく差分にプロパティが含まれるかで更新を判定する。
		if (Object.hasOwn(newOptions, 'fpsLimit')) {
			this.effectLivePreviewRenderLoop.fpsLimit = this.dynamicOptions.fpsLimit;
		}
		if (Object.hasOwn(newOptions, 'effectLivePreviewTimeFactor')) {
			this.effectLivePreviewRenderLoop.timeFactor = this.dynamicOptions.effectLivePreviewTimeFactor;
		}
		if (reinitialize) this.initializePlacement();
		else if (newOptions.automationGraphs != null) this.activeEffect?.inputs.updateAutomationGraphs(newOptions.automationGraphs);
	}

	public applyProjectChanges(changes: readonly RendererProjectChange[]) {
		const relevant = changes.filter(isEffectLivePreviewProjectChange);
		if (relevant.length === 0) return;
		const { timelineScenes, ...next } = applyRendererProjectChanges({ ...this.dynamicOptions, timelineScenes: [] }, relevant);
		// 初期化失敗後はインスタンスがないので、参照先の値修正からも選択中の配置を復旧する。
		const changesRequiringInitialization = this.activeEffect == null ? relevant : relevant.filter(change => !isNodesEffectValueChange(change));
		const affected = changedEffectReferences(changesRequiringInitialization, next);
		if (next.nodesEffects !== this.dynamicOptions.nodesEffects || next.customShaderEffects !== this.dynamicOptions.customShaderEffects) {
			this.definitions = createProjectEffectDefinitions(next, this.nativeEffectDefinitions);
		}
		Object.assign(this.dynamicOptions, next);
		if (this.placement != null && affected?.(this.placement.effectSource) === true) {
			this.initializePlacement();
		} else if (this.activeEffect != null) {
			for (const change of relevant) {
				if (isNodesEffectValueChange(change)) this.activeEffect.pendingValues.enqueue(change);
				if (change.type === 'automationGraphs') this.activeEffect.inputs.updateAutomationGraphs(next.automationGraphs);
			}
		}
	}

	public updateEffectLivePreviewParamValues(params: EffectLivePreviewParameters) {
		if (this.placement == null) return;
		this.placement = { ...this.placement, params };
		// 評価済みの入力は次のbeginFrameまで変わらない。値だけの編集は実行中のタイルや履歴を維持する。
		if (this.activeEffect?.inputs.updateParameters(params) !== true) this.initializePlacement();
	}

	public updateEffectLivePreviewResolution(customResolution: Resolution | null) {
		if (this.placement == null) return;
		this.placement = { ...this.placement, customResolution };
		this.initializePlacement();
	}

	public startEffectLivePreview(placement: EffectLivePreviewPlacement, statusInstanceId = genId()) {
		this.stopRenderLoop();
		// 初期設定の通知が購読開始より早い場合や、同じ寸法の配置へ切り替えた場合にも、最初の描画で寸法を通知する。
		this.displayedResolution = null;
		this.placement = placement;
		this.effectLivePreviewStatusInstanceId = statusInstanceId;
		this.initializePlacement();
		if (this.activeEffect != null) this.effectLivePreviewRenderLoop.start();
	}

	private releasePlacement() {
		this.previewTiledFrameController?.abort();
		this.previewRenderGeneration++;
		this.previewRenderDelayMonitor.clear();
		const active = this.activeEffect;
		if (active == null) return;
		this.activeEffect = null;
		active.lifetime.abort();
		active.instance?.dispose();
		this.emit('ev', { type: 'effectState', ctx: { source: { type: 'effectLivePreview', instanceId: this.effectLivePreviewStatusInstanceId! }, status: null } });
	}

	private getPlacementResolutionOptions() {
		const customResolution = this.placement?.customResolution;
		return customResolution == null
			? { resolution: this.dynamicOptions.resolution, resolutionScale: this.dynamicOptions.resolutionScale }
			: { resolution: customResolution, resolutionScale: 1 };
	}

	private initializePlacement() {
		// 配置の再初期化ではWorkerの素材・GPUDeviceと状態通知のIDを引き継ぐ。
		this.releasePlacement();
		const placement = this.placement;
		if (placement == null) return;
		const { effectSource } = placement;
		if ((effectSource.type === 'nodesEffectReference' && !this.dynamicOptions.nodesEffects.some(entry => entry.id === effectSource.id))
			|| (effectSource.type === 'customShaderEffectReference' && !this.dynamicOptions.customShaderEffects.some(entry => entry.id === effectSource.id))) {
			this.stopRenderLoop();
			return;
		}
		const { definition } = resolveEffectSource(effectSource, this.definitions);
		const requestedPort = placement.outputPort ?? definition.primaryOutput ?? Object.keys(definition.outputDefs)[0] ?? null;
		const port = requestedPort != null && Object.hasOwn(definition.outputDefs, requestedPort) ? requestedPort : null;
		const source: EffectLivePreviewStatusSource = { type: 'effectLivePreview', instanceId: this.effectLivePreviewStatusInstanceId! };
		const lifetime = new AbortController();
		const inputs = createEffectLivePreviewInputs(definition, placement.params ?? {}, this.dynamicOptions.automationGraphs, {
			image: () => this.previewImage.bind(),
			audio: () => this.previewAudioCapture?.snapshot() ?? this.previewAudio?.atTime(this.previewAudioPosition, this.previewAudioGeneration) ?? null,
		});
		const gpuTiming = this.staticOptions.enableStats ? {
			frameTimes: new WeakMap<EffectFrameContext, Promise<number | null>>(), pending: Promise.resolve(),
		} : null;
		let previousStatus: EffectPreparationStatus | null = null;
		const maxDimension = this.gpuDevice.limits?.maxTextureDimension2D;
		const customResolution = placement.customResolution;
		// 出力未接続でも描画コンテキストの寸法でCanvasを確保するため、GPUの上限を先に確認する。
		const ready = customResolution != null && maxDimension != null
			&& (customResolution.width > maxDimension || customResolution.height > maxDimension)
			? Promise.reject(new Error(`Preview resolution exceeds ${maxDimension}: ${customResolution.width} × ${customResolution.height}`))
			: createEffectInstance({
				effectSource: placement.effectSource, definitions: this.definitions, inputs: inputs.inputs, staticSettings: placement.staticSettings,
				usedOutputPorts: new Set(port == null ? [] : [port]), ...this.getPlacementResolutionOptions(),
				resources: { assets: this.resources.assets, assetTextures: this.assetTextures.textures },
				tiling: this.staticOptions.effectRenderTiling ?? { mode: 'auto' },
				onPreparationStatus: status => {
					if (lifetime.signal.aborted || (status.type !== 'error' && previousStatus?.type === status.type)) return;
					previousStatus = status;
					this.emit('ev', { type: 'effectState', ctx: { source, status } });
				},
				onFrameGpuTime: gpuTiming == null ? undefined : (frame, result) => { gpuTiming.frameTimes.set(frame, result); },
			}, { device: this.gpuDevice, defaultVertexShaderModule: this.vertex, enable32bitDataTextures: this.staticOptions.enable32bitDataTextures },
			id => this.nativeEffectImplementations[id], lifetime.signal);
		const active: NonNullable<EffectLivePreviewManager['activeEffect']> = { lifetime, inputs, ready, port, instance: null, gpuTiming, pendingValues: new PendingNodesEffectValues(null) };
		this.activeEffect = active;
		void ready.then(instance => {
			if (lifetime.signal.aborted) instance.dispose();
			else active.instance = instance;
		}, error => {
			if (lifetime.signal.aborted) return;
			// 初期化中に届いた値修正はまだ適用できていない。失敗した配置がその登録を使って
			// いれば、最新の定義から再試行する。新しい編集がなければ失敗はそのまま通知する。
			if (changedEffectReferences(active.pendingValues.edits, this.dynamicOptions)?.(effectSource) === true) {
				this.initializePlacement();
				return;
			}
			// 編集中のShaderはコンパイルに失敗し得る。配置の選択と時計を保持し、
			// 次の定義編集で同じLive Previewを復旧できるようにする。
			this.releasePlacement();
			this.canvasRenderer.clear();
			this.reportRenderError(error instanceof Error ? error.message : String(error));
		});
	}

	private async renderEffectLivePreviewFrame(timing: EffectLivePreviewFrameTiming) {
		const active = this.activeEffect;
		if (active == null) return;
		this.skippedFrameTimeDelta += timing.timeDelta;
		this.skippedFrameRealTimeDelta += timing.realTimeDelta;
		const cpuFrame = this.canvasRenderer.tryReserveCpuPreviewFrame();
		if (this.canvasRenderer.usesCpuDisplay && cpuFrame == null) return;
		const controller = new AbortController();
		this.previewTiledFrameController = controller;
		const signal = AbortSignal.any([active.lifetime.signal, controller.signal]);
		const generation = ++this.previewRenderGeneration;
		// 次の描画より遅れたGPU計測も有効なので、履歴リセットと配置の寿命で結果の有効性を判定する。
		const historyGeneration = this.historyGeneration;
		const pointer = this.pointerPosition;
		const placementResolution = this.getPlacementResolutionOptions();
		const resolution = scaleResolution(placementResolution.resolution, placementResolution.resolutionScale);
		const frame: EffectFrameContext = {
			time: timing.time / 1000,
			timeDelta: this.skippedFrameTimeDelta,
			endTime: Infinity,
			pointerPosition: pointer.x <= -999 && pointer.y <= -999 ? [pointer.x, pointer.y] : normalizedToSpatialCoordinates([pointer.x, pointer.y], resolution),
			pointerVector: this.pointerPositionPrev.x === -99999 ? [0, 0] : normalizedToSpatialCoordinates([pointer.x - this.pointerPositionPrev.x, pointer.y - this.pointerPositionPrev.y], resolution),
		};
		const realTimeDelta = this.skippedFrameRealTimeDelta;
		// 見送った描画の時間差は今回のContextへ渡し、準備中に進んだ分は次の描画へ回す。
		this.skippedFrameTimeDelta = this.skippedFrameRealTimeDelta = 0;
		this.previewRenderDelayMonitor.beginFrame(frame);
		try {
			const effect = await active.ready;
			signal.throwIfAborted();
			active.pendingValues.applyTo(effect);
			active.inputs.beginFrame(timing.time);
			await effect.renderTiled(frame, signal, progress => this.previewRenderDelayMonitor.updateTilingProgress(frame, progress), encoder => {
				const output = active.port == null ? null : effect.outputs.get(active.port);
				this.updateCanvasResolution(output?.resolution ?? resolution);
				signal.throwIfAborted();
				// 出力がないフレームも同じ表示・読み戻し経路を使う。初期値が透明黒の読み取り専用画像を再利用する。
				const texture = output?.texture ?? (this.transparentTexture ??= this.gpuDevice.createTexture({
					size: { width: 1, height: 1 },
					format: INTERMEDIATE_TEXTURE_FORMAT,
					usage: GPUTextureUsage.TEXTURE_BINDING,
				}));
				this.canvasRenderer.renderToCanvas(texture, encoder, timing.time, generation);
				cpuFrame?.prepareReadback(encoder);
			});
			signal.throwIfAborted();
			this.pointerPositionPrev = pointer;
			const gpuTiming = active.gpuTiming;
			if (gpuTiming != null) {
				if (realTimeDelta > 0) this.fpsAverage.addSample(1000 / realTimeDelta);
				const result = gpuTiming.frameTimes.get(frame);
				if (result != null) {
					// readbackの到着順に関係なく、表示へ送信した順で移動平均を更新する。
					gpuTiming.pending = gpuTiming.pending.then(async () => {
						const milliseconds = await result;
						if (milliseconds == null || signal.aborted || historyGeneration !== this.historyGeneration) return;
						const microseconds = milliseconds * 1000;
						this.gpuAverageFast.addSample(microseconds);
						this.gpuAverageMedium.addSample(microseconds);
						this.gpuAverageSlow.addSample(microseconds);
					});
				}
			}
			// CPU表示ではUIへの画像送信まで遅延を監視しつつ、描画ループは次のフレームへ進める。
			const complete = cpuFrame?.complete() ?? this.gpuDevice.queue.onSubmittedWorkDone();
			void complete.catch(error => {
				cpuFrame?.cancel();
				if (!signal.aborted && historyGeneration === this.historyGeneration) this.reportRenderError(error instanceof Error ? error.message : String(error));
			}).finally(() => this.previewRenderDelayMonitor.completeFrame(frame));
		} catch (error) {
			cpuFrame?.cancel();
			this.previewRenderDelayMonitor.completeFrame(frame);
			if (!signal.aborted) throw error;
		} finally {
			if (this.previewTiledFrameController === controller) this.previewTiledFrameController = null;
			const pending = this.pendingPreviewImage;
			this.pendingPreviewImage = undefined;
			if (pending !== undefined) this.updatePreviewImage(pending);
		}
	}

	private updateCanvasResolution(resolution: Resolution) {
		if (this.displayedResolution?.width === resolution.width && this.displayedResolution.height === resolution.height) return;
		const canvas = this.gpuContext.canvas;
		if (canvas.width !== resolution.width) canvas.width = resolution.width;
		if (canvas.height !== resolution.height) canvas.height = resolution.height;
		this.displayedResolution = { width: resolution.width, height: resolution.height };
		this.emit('ev', { type: 'outputResolution', ctx: this.displayedResolution });
	}

	public resetRenderHistory() {
		this.historyGeneration++;
		if (this.activeEffect?.gpuTiming != null) this.activeEffect.gpuTiming.pending = Promise.resolve();
		this.previewTiledFrameController?.abort();
		this.previewRenderDelayMonitor.clear();
		this.previewRenderGeneration++;
		this.activeEffect?.instance?.resetRenderHistory();
		this.pointerPositionPrev = this.pointerPosition;
		this.clicks = [];
		this.skippedFrameTimeDelta = this.skippedFrameRealTimeDelta = 0;
	}

	public stopRenderLoop() {
		this.releasePlacement();
		this.effectLivePreviewRenderLoop.stop();
		this.previewRenderDelayMonitor.stop();
		this.skippedFrameTimeDelta = this.skippedFrameRealTimeDelta = 0;
		this.canvasRenderer.clear();
		this.placement = null;
		this.effectLivePreviewStatusInstanceId = null;
	}

	public destroy() {
		if (this.telemetryReportIntervalId != null) clearInterval(this.telemetryReportIntervalId);
		if (this.gpuMemoryReportIntervalId != null) clearInterval(this.gpuMemoryReportIntervalId);
		this.stopRenderLoop();
		this.transparentTexture?.destroy();
		this.assetTextures.dispose();
		this.previewAudio?.dispose();
		this.previewAudioCapture?.dispose();
		this.previewImage.dispose();
		if (this.pendingPreviewImage?.kind === 'frame') this.pendingPreviewImage.frame.close();
		this.pendingPreviewImage = undefined;
		this.canvasRenderer.destroy();
		this.gpuDevice.destroy();
	}

	public setHighResolutionImageAnalysis(enabled: boolean, settings: PreviewImageAnalysisSettings) {
		return this.canvasRenderer.setHighResolutionImageAnalysis(enabled, settings);
	}

	public capturePreview(maximumSize: number) {
		if (this.placement == null) return Promise.resolve(null);
		return this.canvasRenderer.captureNextPreviewFrame(maximumSize, this.previewRenderGeneration);
	}

	public async setImageAnalysisDisplay(settings: PreviewImageAnalysisDisplaySettings, refresh: boolean) {
		// 通常のdynamic options更新を通すと、解析だけのリサイズでもタイル描画を中断してしまう。
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
	staticOptions: EffectLivePreviewManagerStaticOptions;
	dynamicOptions: Partial<EffectLivePreviewManagerDynamicOptions>;
	resources: EffectLivePreviewManagerResources;
	nativeEffectDefinitions: NativeEffectDefinitions;
	nativeEffectImplementations: Readonly<Record<string, NativeEffectImplementation>>;
}) {
	const adapter = await navigator.gpu?.requestAdapter({
		powerPreference: 'high-performance',
	});

	const device = await adapter?.requestDevice({
		requiredFeatures: getRendererRequiredGpuFeatures(adapter, { ...options.staticOptions, enableGpuStatistics: options.staticOptions.enableStats }),
	});
	if (device == null) {
		throw new Error('need a browser that supports WebGPU');
	}

	let manager: EffectLivePreviewManager | null = null;
	let coreConfig: EffectLivePreviewManagerCoreConfig;
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
	manager = await EffectLivePreviewManager.create(coreConfig, options.staticOptions, options.resources);
	try {
		manager.updateDynamicOptions(options.dynamicOptions);
		return manager;
	} catch (error) {
		manager.destroy();
		throw error;
	}
}
