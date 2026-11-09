import type { ImageValueScale } from '@gs/shared/utility/image-value-scale.ts';
import { createProjectEffects } from './custom-shader-effects.ts';
import type { ProjectCustomShaderEffect } from '@gs/glitch-studio_shared/project/types.ts';
import { getPlayerIntrinsicResolution } from '@gs/glitch-studio_shared/player-resolution.ts';
import { scaleResolution, type Resolution } from '@gs/shared/resolution.ts';
import { applyRendererProjectChanges } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import { AudioHistory } from '@gs/subsystems_audio_renderer/audio-history.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { genEmptyValue } from '@gs/shared/parameter/parameter-default.ts';
import EventEmitter from 'eventemitter3';
import { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
import { validateEnumParameterValue } from '@gs/shared/parameter/parameter-definition.ts';
import { coerceParameterValue } from '@gs/shared/parameter/coerce-parameter-value.ts';
import { UniformOrTextureToTextureResolver } from '@gs/shared/gpu/uniform-or-texture-to-texture-resolver.ts';
import { VisualModuleRenderer, type VisualModuleRenderContext } from '@gs/subsystems_visual-module_renderer/visual-module-renderer.ts';
import { browserFrameScheduler, VisualModuleLivePreviewRenderLoop } from '@gs/subsystems_visual-module_renderer/visual-module-live-preview-render-loop.ts';
import TimingHelper from '@gs/shared/gpu/TimingHelper.ts';
import { isVisualModuleValueChange } from './project-change-policy.ts';
import { AssetTextures } from './asset-textures.ts';
import { PlayerAudioInputs } from './player-audio-inputs.ts';
import { NonNegativeRollingAverage } from './utility/NonNegativeRollingAverage.ts';
import { GpuMemoryTracker } from './utility/GpuMemoryTracker.ts';
import { CanvasRenderer } from './canvas-renderer.ts';
import { createPreviewCanvasContext, createPreviewCanvasConfigurator } from './preview-canvas-context.ts';
import type { PreviewCanvasContext, PreviewDisplayMode, CpuPreviewFrame, CpuPreviewCanvasTarget } from './preview-canvas-context.ts';
import type { FrameScheduler, VisualModuleLivePreviewFrameTiming } from '@gs/subsystems_visual-module_renderer/visual-module-live-preview-render-loop.ts';
import type { RendererProjectChange } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';
import type { VisualModulePublicParameterId, VisualModuleArgumentBindings } from '@gs/subsystems_visual-module_shared/types.ts';
import type { EffectInstanceState } from '@gs/subsystems_effect_shared/effect-status.ts';
import type { AudioSourceId } from '@gs/shared/audio.ts';
import type { AudioCaptureMessage } from '@gs/subsystems_audio_shared/audio-capture.ts';
import { INTERMEDIATE_TEXTURE_FORMAT, type Asset, type Player } from '@gs/shared/types.ts';
import type { EffectImplementation } from '@gs/subsystems_effect_shared/effect-implementation.js';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.js';
import type { VISUAL_MODULE_LIVE_PREVIEW_VAR_DEFS } from '@gs/glitch-studio_shared/visual-module-live-preview-expression.js';

/**
 * 初期化時に決まっている必要がある設定情報
 */
export type VisualModuleRendererManagerStaticOptions = {
	previewDisplayMode?: PreviewDisplayMode;
	enable32bitDataTextures: boolean;
	effectRenderTileDivisionLevel?: number;
	enableStats: boolean;
	/** プレビュー用の波形・ヒストグラムのGPU処理を有効にする。 */
	enableWaveformAndHistogram: boolean;
};

/**
 * 初期化後に変更可能な設定情報
 */
export type VisualModuleRendererManagerDynamicOptions = {
	resolution: Resolution;
	/** プレビューの計算倍率。書き出しは1を使う。 */
	resolutionScale: number;
	/** 最終出力の黒つぶれを緑、白飛びをマゼンタで表示する。 */
	highlightClipping: boolean;
	/** 表示用の露出（EV）。作品内の画像・解析には適用せず、書き出しでは0を使う。 */
	previewExposure: number;
	/** 透過非対応の出力用に、乗算済みRGBを黒背景へ合成する。 */
	opaqueOutput: boolean;
	/** 表示用背景。nullは透明出力で、書き出しではプレビュー背景を使わない。 */
	previewBackground: 'black' | 'checker' | null;
	analysisValueScale: ImageValueScale;
	visualModuleLivePreviewTimeFactor: number;
	/** Visual Module Live Preview専用の描画頻度上限。タイムラインには適用しない。 */
	fpsLimit: number | null;
	visualModules: ProjectVisualModule[];
	automationGraphs: AutomationGraph[];
};

/** 素材・Playerは寿命中に固定する。Custom Shader Effectは初期値で、配置と一括更新できる。 */
export type VisualModuleRendererManagerResources = { customShaderEffects?: readonly ProjectCustomShaderEffect[]; assets: readonly Asset[]; players: readonly Player[] };

/** Managerが所有するGPU環境と、注入する描画機能。 */
export type VisualModuleRendererManagerCoreConfig = {
	gpuDevice: GPUDevice;
	gpuContext: PreviewCanvasContext;
	frameScheduler?: FrameScheduler;
	histogramGpuContext?: PreviewCanvasContext;
	waveformHorizontalGpuContext?: PreviewCanvasContext;
	waveformVerticalGpuContext?: PreviewCanvasContext;
	effectDefinitions: Record<string, EffectDefinition<any>>;
	effectImplementations: Record<string, EffectImplementation<any>>;
};

export type VisualModuleLivePreviewEffectStatusSource = { type: 'visualModuleLivePreview'; instanceId: string; visualModuleId: string };

export type VisualModuleRendererManagerEvents = {
	'cpuPreviewFrame': (ctx: CpuPreviewFrame) => void;
	'outputResolution': (ctx: Resolution) => void;
	'effectState': (ctx: { source: VisualModuleLivePreviewEffectStatusSource; nodeId: string; status: EffectInstanceState | null }) => void;
	'renderError': (ctx: { message: string }) => void;
	'telemetry': (ctx: { fpsAverage: number; gpuAverageFast: number; gpuAverageMedium: number; gpuAverageSlow: number; }) => void;
	'gpuMemory': (ctx: { usage: { total: number; textures: number; buffers: number; } }) => void;
};

export class VisualModuleRendererManager extends EventEmitter<{
	'ev': (ctx: { [K in keyof VisualModuleRendererManagerEvents]: { type: K; ctx: Parameters<VisualModuleRendererManagerEvents[K]>[0] } }[keyof VisualModuleRendererManagerEvents]) => void;
}> {
	private previewTiledFrameController: AbortController | null = null;
	private pendingVideoFrames = new Map<Player['id'], VideoFrame | null>();
	private previewRenderGeneration = 0;
	private gpuContext: PreviewCanvasContext;
	private configureCanvas: ReturnType<typeof createPreviewCanvasConfigurator>;
	private skippedFrameTimeDelta = 0;
	private skippedFrameRealTimeDelta = 0;
	private gpuDevice: GPUDevice;
	private canvasRenderer: CanvasRenderer;
	private fallbackTexture: GPUTexture;
	private outputTextures: UniformOrTextureToTextureResolver;
	private frameScheduler: FrameScheduler;
	private visualModuleLivePreviewRenderLoop: VisualModuleLivePreviewRenderLoop;
	private visualModuleLivePreviewVisualModuleId: ProjectVisualModule['id'] | null = null;
	private visualModuleLivePreviewParamValues: VisualModuleArgumentBindings = {};
	private visualModuleLivePreviewParamEvaluator = new ParameterBindingEvaluator();
	private visualModuleLivePreviewVisualModuleRenderer: VisualModuleRenderer | null = null;
	private pendingVisualModuleLivePreviewFrame: VisualModuleRenderContext | null = null;
	private pendingVisualModuleLivePreviewValueUpdate = false;
	private visualModuleLivePreviewStatusInstanceId: string | null = null;
	private assetTextures: AssetTextures;
	private readonly resources: VisualModuleRendererManagerResources;
	private videoFrames: Map<Player['id'], VideoFrame> = new Map();
	private videoFrameVersions: Map<Player['id'], number> = new Map();
	private audioSources = new Map<AudioSourceId, AudioHistory>();
	private playerAudioInputs = new PlayerAudioInputs(this.audioSources);
	private audioPorts = new Map<AudioSourceId, MessagePort>();
	private timingHelper: TimingHelper | null;
	private pointerPosition: { x: number; y: number } = { x: -99999, y: -99999 };
	private pointerPositionPrev: { x: number; y: number } = { x: -99999, y: -99999 };
	private effectDefinitions: Record<string, EffectDefinition<any>>;
	private effectImplementations: Record<string, EffectImplementation<any>>;
	private readonly builtinEffectDefinitions: Record<string, EffectDefinition<any>>;
	private readonly builtinEffectImplementations: Record<string, EffectImplementation<any>>;
	private gpuAverageFast = new NonNegativeRollingAverage(10);
	private gpuAverageMedium = new NonNegativeRollingAverage(100);
	private gpuAverageSlow = new NonNegativeRollingAverage(1000);
	private fpsAverage = new NonNegativeRollingAverage(30);
	private telemetryReportIntervalId: ReturnType<typeof setInterval> | null = null;
	private gpuMemoryReportIntervalId: ReturnType<typeof setInterval> | null = null;
	private displayedResolution: Resolution | null = null;

	private readonly staticOptions: VisualModuleRendererManagerStaticOptions;
	private dynamicOptions: VisualModuleRendererManagerDynamicOptions = {
		resolution: { width: 1, height: 1 },
		resolutionScale: 1,
		highlightClipping: false,
		previewExposure: 0,
		visualModuleLivePreviewTimeFactor: 1.0,
		fpsLimit: null,
		opaqueOutput: false,
		previewBackground: null,
		analysisValueScale: 'srgb',
		visualModules: [],
		automationGraphs: [],
	};

	private constructor(coreConfig: VisualModuleRendererManagerCoreConfig, staticOptions: VisualModuleRendererManagerStaticOptions, resources: VisualModuleRendererManagerResources) {
		super();

		this.staticOptions = { ...staticOptions };
		this.resources = resources;

		this.frameScheduler = coreConfig.frameScheduler ?? browserFrameScheduler;
		this.visualModuleLivePreviewRenderLoop = new VisualModuleLivePreviewRenderLoop({
			scheduler: this.frameScheduler,
			onFrame: timing => {
				// 描画失敗は所有者へ通知する。エンジンの破棄と再生成は所有者が行う。
				try {
					const pending = this.renderVisualModuleLivePreviewFrame(timing);
					return pending?.catch(error => this.reportRenderError(error instanceof Error ? error.message : String(error)));
				} catch (error) {
					this.reportRenderError(error instanceof Error ? error.message : String(error));
					return;
				}
			},
			onSkippedFrame: timing => {
				this.skippedFrameTimeDelta += timing.timeDelta;
				this.skippedFrameRealTimeDelta += timing.realTimeDelta;
			},
			fpsLimit: this.dynamicOptions.fpsLimit,
			timeFactor: this.dynamicOptions.visualModuleLivePreviewTimeFactor,
		});
		this.gpuDevice = coreConfig.gpuDevice;
		this.outputTextures = new UniformOrTextureToTextureResolver(this.gpuDevice, this.staticOptions.enable32bitDataTextures);
		this.gpuContext = coreConfig.gpuContext;
		this.builtinEffectDefinitions = coreConfig.effectDefinitions;
		this.builtinEffectImplementations = coreConfig.effectImplementations;
		const effects = createProjectEffects(resources.customShaderEffects ?? [], coreConfig.effectDefinitions, coreConfig.effectImplementations);
		this.effectDefinitions = effects.definitions;
		this.effectImplementations = effects.implementations;

		const gpuMemory = this.staticOptions.enableStats ? new GpuMemoryTracker(this.gpuDevice) : null;
		this.timingHelper = this.staticOptions.enableStats ? new TimingHelper(this.gpuDevice) : null;

		this.configureCanvas = createPreviewCanvasConfigurator(this.gpuDevice, this.gpuContext);
		this.configureCanvas('premultiplied');

		this.fallbackTexture = this.gpuDevice.createTexture({
			size: [1, 1],
			format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING,
		});

		this.canvasRenderer = new CanvasRenderer({
			gpuDevice: this.gpuDevice,
			gpuContext: this.gpuContext,
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
	public static async create(coreConfig: VisualModuleRendererManagerCoreConfig, staticOptions: VisualModuleRendererManagerStaticOptions,
		resources: VisualModuleRendererManagerResources, signal?: AbortSignal): Promise<VisualModuleRendererManager> {
		let manager: VisualModuleRendererManager | null = null;
		try {
			signal?.throwIfAborted();
			manager = new VisualModuleRendererManager(coreConfig, staticOptions, resources);
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
		this.emit('ev', { type: 'renderError', ctx: { message } });
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
		if (this.previewTiledFrameController != null) {
			// 実行中フレームが借用しているVideoFrameは閉じない。待機中の更新は最新だけ保持する。
			this.pendingVideoFrames.get(playerId)?.close();
			this.pendingVideoFrames.set(playerId, videoFrame);
			return;
		}
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
	}

	// (非workerで)呼び出すときは値を独立した参照にすること！ パフォーマンス上の理由でこちら側ではdeepCloneしません
	public updateDynamicOptions(newOptions: Partial<VisualModuleRendererManagerDynamicOptions>) {
		this.cancelTiledPreviewFrame();
		this.dynamicOptions = { ...this.dynamicOptions, ...newOptions };
		if (['resolution', 'resolutionScale', 'visualModules', 'automationGraphs'].some(key => Object.hasOwn(newOptions, key))) {
			this.pendingVisualModuleLivePreviewFrame = null;
		}
		this.canvasRenderer.highlightClipping = this.dynamicOptions.highlightClipping;
		this.canvasRenderer.previewExposure = this.dynamicOptions.previewExposure;
		this.canvasRenderer.opaqueOutput = this.dynamicOptions.opaqueOutput;
		this.canvasRenderer.previewBackground = this.dynamicOptions.previewBackground;
		// 背景合成後は不透明。背景を持たない透明書き出しだけ、Canvasのalphaも維持する。
		this.configureCanvas(this.dynamicOptions.opaqueOutput || this.dynamicOptions.previewBackground != null ? 'opaque' : 'premultiplied');
		this.canvasRenderer.analysisValueScale = this.dynamicOptions.analysisValueScale;

		// Partialの差分では省略は変更なし、明示的なnullは解除要求。値の有無ではなくown propertyで判定する。
		if (Object.hasOwn(newOptions, 'resolution') || Object.hasOwn(newOptions, 'resolutionScale')) {
			this.updateCanvasResolution(scaleResolution(this.dynamicOptions.resolution, this.dynamicOptions.resolutionScale));
			this.visualModuleLivePreviewVisualModuleRenderer?.resize(this.dynamicOptions.resolution, this.dynamicOptions.resolutionScale);
		}
		// nullはFPS制限の解除なので、値ではなく差分にプロパティが含まれるかで更新を判定する。
		if (Object.hasOwn(newOptions, 'fpsLimit')) {
			this.visualModuleLivePreviewRenderLoop.fpsLimit = this.dynamicOptions.fpsLimit;
		}
		if (Object.hasOwn(newOptions, 'visualModuleLivePreviewTimeFactor')) {
			this.visualModuleLivePreviewRenderLoop.timeFactor = this.dynamicOptions.visualModuleLivePreviewTimeFactor;
		}
		if (Object.hasOwn(newOptions, 'visualModules')) {
			if (this.visualModuleLivePreviewVisualModuleRenderer != null) {
				const visualModule = this.dynamicOptions.visualModules.find(visualModule => visualModule.id === this.visualModuleLivePreviewVisualModuleId);
				if (visualModule == null) this.stopRenderLoop();
				else this.visualModuleLivePreviewVisualModuleRenderer.updateVisualModule(visualModule);
			}
		}
	}

	public applyProjectChanges(changes: readonly RendererProjectChange[]) {
		const relevant = changes.filter(change => change.type === 'customShaderEffects' || change.type === 'automationGraphs' || change.type === 'visualModuleRegistration'
			|| (change.type === 'node' || change.type === 'visualModule') && 'visualModuleId' in change.target);
		const next = applyRendererProjectChanges({ automationGraphs: this.dynamicOptions.automationGraphs, visualModules: this.dynamicOptions.visualModules, timelineScenes: [] }, relevant);
		const customShaderEffects = relevant.findLast(change => change.type === 'customShaderEffects');
		const effects = customShaderEffects == null ? null : createProjectEffects(customShaderEffects.customShaderEffects, this.builtinEffectDefinitions, this.builtinEffectImplementations);
		this.dynamicOptions.visualModules = next.visualModules;
		this.dynamicOptions.automationGraphs = next.automationGraphs;
		if (relevant.some(change => change.type === 'automationGraphs')) {
			this.cancelTiledPreviewFrame();
			this.pendingVisualModuleLivePreviewFrame = null;
		}
		if (effects != null) {
			this.effectDefinitions = effects.definitions;
			this.effectImplementations = effects.implementations;
			// 全配置を作り直しても、Workerの素材・Player・GPUDeviceは維持する。
			// 状態通知のIDも維持し、Controllerが新しいインスタンスの通知を受け取れるようにする。
			if (this.visualModuleLivePreviewVisualModuleId != null && this.visualModuleLivePreviewStatusInstanceId != null) {
				this.startVisualModuleLivePreviewRenderLoopFor(this.visualModuleLivePreviewVisualModuleId, this.visualModuleLivePreviewParamValues, this.visualModuleLivePreviewStatusInstanceId);
			}
			return;
		}
		const visualModuleLivePreviewChanges = relevant.filter(change => change.type === 'visualModuleRegistration' ? change.visualModuleId === this.visualModuleLivePreviewVisualModuleId
			: (change.type === 'node' || change.type === 'visualModule') && 'visualModuleId' in change.target && change.target.visualModuleId === this.visualModuleLivePreviewVisualModuleId);
		if (visualModuleLivePreviewChanges.length > 0 && this.visualModuleLivePreviewVisualModuleRenderer != null) {
			this.pendingVisualModuleLivePreviewFrame = null;
			const visualModule = next.visualModules.find(visualModule => visualModule.id === this.visualModuleLivePreviewVisualModuleId);
			const preserveStaticState = visualModuleLivePreviewChanges.every(isVisualModuleValueChange);
			if (preserveStaticState && this.previewTiledFrameController != null) {
				// 差分をためず、上で更新した最新スナップショットだけを次の描画へ渡す。
				// 値の編集で描画を中断すると、復旧時にインスタンスと出力寸法まで初期化される。
				this.pendingVisualModuleLivePreviewValueUpdate = true;
				return;
			}
			this.cancelTiledPreviewFrame();
			this.pendingVisualModuleLivePreviewValueUpdate = false;
			if (visualModule == null) this.stopRenderLoop();
			else this.visualModuleLivePreviewVisualModuleRenderer.updateVisualModule(visualModule, { preserveStaticState });
		}
	}

	public updateVisualModuleLivePreviewParamValues(paramValues: VisualModuleArgumentBindings) {
		// 実行中フレームは評価済みのContextを使う。公開入力も最新値だけを次回の評価へ渡す。
		this.pendingVisualModuleLivePreviewFrame = null;
		this.visualModuleLivePreviewParamValues = paramValues;
	}

	public startVisualModuleLivePreviewRenderLoopFor(visualModuleId: string, paramValues: VisualModuleArgumentBindings = {}, statusInstanceId = genId()) {
		this.stopRenderLoop();
		// 初期設定の通知は購読開始前に行われ得るため、最初の描画では同じ寸法でも通知する。
		// 対象の切り替え時も、UIが前のVisual Moduleの寸法を使い続けないようにする。
		this.displayedResolution = null;

		const visualModule = this.dynamicOptions.visualModules.find(g => g.id === visualModuleId);
		if (visualModule == null) return;

		this.visualModuleLivePreviewVisualModuleId = visualModuleId;
		this.visualModuleLivePreviewParamValues = paramValues;
		this.visualModuleLivePreviewStatusInstanceId = statusInstanceId;
		const statusSource: VisualModuleLivePreviewEffectStatusSource = { type: 'visualModuleLivePreview', instanceId: statusInstanceId, visualModuleId };
		this.visualModuleLivePreviewVisualModuleRenderer = new VisualModuleRenderer({
			gpuDevice: this.gpuDevice,
			fallbackTexture: this.fallbackTexture,
			resolution: this.dynamicOptions.resolution,
			resolutionScale: this.dynamicOptions.resolutionScale,
			getPlayerResolution: playerId => getPlayerIntrinsicResolution(playerId, this.resources.players, this.resources.assets),
			enable32bitDataTextures: this.staticOptions.enable32bitDataTextures,
			effectRenderTileDivisionLevel: this.staticOptions.effectRenderTileDivisionLevel,
			enableStats: this.staticOptions.enableStats,
			timingHelper: this.timingHelper,
			onEffectState: (nodeId, status) => this.emit('ev', { type: 'effectState', ctx: { source: statusSource, nodeId, status } }),
			videoFrames: this.videoFrames,
			videoFrameVersions: this.videoFrameVersions,
			assets: this.resources.assets,
			visualModule,
			assetTextures: this.assetTextures.textures,
			resolveAudioSource: selection => this.playerAudioInputs.resolve(selection),
			effectDefinitions: this.effectDefinitions,
			effectImplementations: this.effectImplementations,
		});

		this.visualModuleLivePreviewRenderLoop.start();
	}

	private createVisualModuleLivePreviewRenderContext(timing: VisualModuleLivePreviewFrameTiming): VisualModuleRenderContext {
		const visualModule = this.dynamicOptions.visualModules.find(visualModule => visualModule.id === this.visualModuleLivePreviewVisualModuleId)!;
		const evaluatedParamValues = new Map<VisualModulePublicParameterId, any>();
		for (const def of visualModule.paramDefs) {
			if (def.dataType.kind === 'audioSource') {
				const binding = this.visualModuleLivePreviewParamValues[def.id] ?? def.defaultValue;
				// 未使用の公開入力では履歴をコピーしない。実際の読み手が必要になった時に
				// 注入したresolveAudioSourceで取得する。音声の指定はPUBLICへ公開されない。
				evaluatedParamValues.set(def.id, (binding as { value: unknown }).value);
				continue;
			}
			if (this.visualModuleLivePreviewParamValues[def.id] == null) {
				evaluatedParamValues.set(def.id, coerceParameterValue(def, validateEnumParameterValue(def, def.defaultValue.value)));
				continue;
			}
			evaluatedParamValues.set(def.id, coerceParameterValue(def, validateEnumParameterValue(def, this.visualModuleLivePreviewParamEvaluator.evaluate(this.visualModuleLivePreviewParamValues[def.id], {
				variables: {
					TIME: timing.time / 1000,
					TIME_MS: timing.time,
				} satisfies Record<typeof VISUAL_MODULE_LIVE_PREVIEW_VAR_DEFS[number], unknown>,
				automationGraphs: this.dynamicOptions.automationGraphs,
				time: timing.time,
				endTime: Infinity,
			}, def.dataType.kind === 'enum' ? null : genEmptyValue(def), def)))); // TODO: genEmptyValueを遅延評価したい
		}
		return {
			evaluatedParamValues,
			time: timing.time,
			timeDelta: timing.timeDelta,
			endTime: Infinity,
			pointerPosition: { ...this.pointerPosition },
			pointerPositionPrev: { ...this.pointerPositionPrev },
			isExport: false,
		};
	}

	private cancelTiledPreviewFrame() {
		if (this.previewTiledFrameController == null) return;
		this.previewRenderGeneration++;
		this.previewTiledFrameController.abort();
	}

	private applyPendingVisualModuleLivePreviewValues() {
		if (!this.pendingVisualModuleLivePreviewValueUpdate) return;
		this.pendingVisualModuleLivePreviewValueUpdate = false;
		const visualModule = this.dynamicOptions.visualModules.find(entry => entry.id === this.visualModuleLivePreviewVisualModuleId);
		if (visualModule != null) this.visualModuleLivePreviewVisualModuleRenderer?.updateVisualModule(visualModule, { preserveStaticState: true });
	}

	private renderVisualModuleLivePreviewFrame(timing: VisualModuleLivePreviewFrameTiming): void | Promise<void> {
		const renderer = this.visualModuleLivePreviewVisualModuleRenderer;
		if (renderer == null) return;
		this.skippedFrameTimeDelta += timing.timeDelta;
		this.skippedFrameRealTimeDelta += timing.realTimeDelta;
		const cpuFrame = this.canvasRenderer.tryReserveCpuPreviewFrame();
		if (this.canvasRenderer.usesCpuDisplay && cpuFrame == null) return;
		timing = { ...timing, timeDelta: this.skippedFrameTimeDelta, realTimeDelta: this.skippedFrameRealTimeDelta };
		const generation = ++this.previewRenderGeneration;
		try {
			// 非同期準備を最新時刻で置き換え続けないよう、開始したフレームを描画まで維持する。
			const context = this.pendingVisualModuleLivePreviewFrame ??= this.createVisualModuleLivePreviewRenderContext(timing);
			if (!renderer.tryPrepare(context)) {
				cpuFrame?.cancel();
				return;
			}
			this.pendingVisualModuleLivePreviewFrame = null;
			// 準備・GPU待機中に進んだ時間は次のフレームへ渡し、二重に消費しない。
			this.skippedFrameTimeDelta -= context.timeDelta;
			this.skippedFrameRealTimeDelta = 0;
			const encoder = this.gpuDevice.createCommandEncoder();
			const present = (output: ReturnType<VisualModuleRenderer['render']>, tiledGpuTime = 0) => {
				try {
					const nodeOutput = output ?? { kind: 'uniform' as const, value: [0, 0, 0, 0] as [number, number, number, number] };
					this.updateCanvasResolution(nodeOutput.kind === 'texture' ? nodeOutput.texture : scaleResolution(this.dynamicOptions.resolution, this.dynamicOptions.resolutionScale));
					this.canvasRenderer.renderToCanvas(this.outputTextures.resolve(nodeOutput), encoder);
					this.pointerPositionPrev = { ...context.pointerPosition };
					if (this.staticOptions.enableStats) this.fpsAverage.addSample(1000 / timing.realTimeDelta);
				} catch (error) {
					cpuFrame?.cancel();
					throw error;
				} finally {
					cpuFrame?.prepareReadback(encoder);
					this.gpuDevice.queue.submit([encoder.finish()]);
					if (cpuFrame != null) void cpuFrame.complete().catch(error => {
						cpuFrame.cancel();
						if (generation === this.previewRenderGeneration) this.reportRenderError(error instanceof Error ? error.message : String(error));
					});
					if (this.timingHelper != null) void this.timingHelper.getResult().then(gpuTime => {
						if (generation !== this.previewRenderGeneration) return;
						this.gpuAverageFast.addSample((gpuTime + tiledGpuTime) / 1000);
						this.gpuAverageMedium.addSample((gpuTime + tiledGpuTime) / 1000);
						this.gpuAverageSlow.addSample((gpuTime + tiledGpuTime) / 1000);
					}).catch(error => {
						if (generation === this.previewRenderGeneration) this.reportRenderError(error instanceof Error ? error.message : String(error));
					});
				}
			};
			if ((this.staticOptions.effectRenderTileDivisionLevel ?? 0) === 0) {
				// 分割なしでは従来どおり全ノードと表示を同じencoderへ記録して一度だけ送信する。
				let output: ReturnType<VisualModuleRenderer['render']>;
				try { output = renderer.render(context, encoder); } catch (error) {
					this.gpuDevice.queue.submit([encoder.finish()]);
					if (this.timingHelper != null) void this.timingHelper.getResult().catch(() => {});
					throw error;
				}
				present(output);
				return;
			}
			const controller = new AbortController();
			this.previewTiledFrameController = controller;
			return renderer.renderTiled(context, controller.signal).then(output => {
				if (generation !== this.previewRenderGeneration || controller.signal.aborted) { cpuFrame?.cancel(); return; }
				present(output, renderer.lastTiledGpuTime);
			}).catch(error => {
				cpuFrame?.cancel();
				if (!controller.signal.aborted && generation === this.previewRenderGeneration) throw error;
			}).finally(() => {
				if (this.previewTiledFrameController === controller) this.previewTiledFrameController = null;
				this.applyPendingVisualModuleLivePreviewValues();
				const pending = this.pendingVideoFrames;
				this.pendingVideoFrames = new Map();
				for (const [playerId, videoFrame] of pending) this.updateVideoFrame(playerId, videoFrame);
			});
		} catch (error) { cpuFrame?.cancel(); throw error; }
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
		this.cancelTiledPreviewFrame();
		this.pendingVisualModuleLivePreviewFrame = null;
		this.previewRenderGeneration++;
		this.visualModuleLivePreviewVisualModuleRenderer?.resetRenderHistory();
		this.pointerPositionPrev = { ...this.pointerPosition };
		this.skippedFrameTimeDelta = 0;
		this.skippedFrameRealTimeDelta = 0;
	}

	public stopRenderLoop() {
		this.cancelTiledPreviewFrame();
		this.pendingVisualModuleLivePreviewValueUpdate = false;
		this.pendingVisualModuleLivePreviewFrame = null;
		this.skippedFrameTimeDelta = 0;
		this.skippedFrameRealTimeDelta = 0;
		this.previewRenderGeneration++;
		this.canvasRenderer.clear();
		this.visualModuleLivePreviewRenderLoop.stop();
		this.visualModuleLivePreviewVisualModuleId = null;
		this.visualModuleLivePreviewStatusInstanceId = null;
		this.visualModuleLivePreviewVisualModuleRenderer?.destroy();
		this.visualModuleLivePreviewVisualModuleRenderer = null;
	}

	public destroy() {
		if (this.telemetryReportIntervalId != null) clearInterval(this.telemetryReportIntervalId);
		if (this.gpuMemoryReportIntervalId != null) clearInterval(this.gpuMemoryReportIntervalId);
		this.stopRenderLoop();
		this.outputTextures.dispose();
		this.assetTextures.dispose();
		for (const id of this.audioPorts.keys()) this.resetAudioSource(id, null);
		for (const frame of this.videoFrames.values()) frame.close();
		this.videoFrames.clear();
		for (const videoFrame of this.pendingVideoFrames.values()) videoFrame?.close();
		this.pendingVideoFrames.clear();
		this.videoFrameVersions.clear();
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
	staticOptions: VisualModuleRendererManagerStaticOptions;
	dynamicOptions: Partial<VisualModuleRendererManagerDynamicOptions>;
	resources: VisualModuleRendererManagerResources;
	effectDefinitions: Record<string, EffectDefinition>;
	effectImplementations: Record<string, EffectImplementation>;
}) {
	const adapter = await navigator.gpu?.requestAdapter({
		powerPreference: 'high-performance',
	});

	const device = await adapter?.requestDevice({
		requiredFeatures: [
			...(options.staticOptions.enable32bitDataTextures ? ['float32-filterable'] as const : []),
			...(options.staticOptions.enableStats ? ['timestamp-query'] as const : []),
		],
	});
	if (device == null) {
		throw new Error('need a browser that supports WebGPU');
	}

	let manager: VisualModuleRendererManager | null = null;
	let coreConfig: VisualModuleRendererManagerCoreConfig;
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
	manager = await VisualModuleRendererManager.create(coreConfig, options.staticOptions, options.resources);
	try {
		manager.updateDynamicOptions(options.dynamicOptions);
		return manager;
	} catch (error) {
		manager.destroy();
		throw error;
	}
}
