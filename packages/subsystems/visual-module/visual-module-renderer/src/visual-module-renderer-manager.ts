import { scaleResolution, type Resolution } from '@glitch/shared/resolution.ts';
import { applyRendererProjectChanges } from '@glitch/shared/project/renderer-state.ts';
import { AudioHistory } from '@glitch/shared/audio-history.ts';
import { genId } from '@glitch/shared/utility/id.ts';
import { genEmptyValue } from '@glitch/shared/utility/misc.ts';
import EventEmitter from 'eventemitter3';
import { ParameterEvaluator } from '@glitch/shared/parameter-evaluator.js';
import { validateEnumParameterValue } from '@glitch/shared/parameter.ts';
import { canPreserveNodeOutputCache } from '../../../../renderer/src/project-change-policy.ts';
import { AssetTextures } from '../../../../renderer/src/asset-textures.ts';
import TimingHelper from '../../../../renderer/src/utility/TimingHelper.ts';
import { NonNegativeRollingAverage } from '../../../../renderer/src/utility/NonNegativeRollingAverage.ts';
import { GpuMemoryTracker } from '../../../../renderer/src/utility/GpuMemoryTracker.ts';
import { OutputTextureResolver } from '../../../../renderer/src/node-output.ts';
import { CanvasRenderer } from '../../../../renderer/src/canvas-renderer.ts';
import { LiveRenderLoop, browserFrameScheduler } from './live-render-loop.ts';
import { VisualModuleRenderer } from './visual-module-renderer.ts';
import type { RendererProjectChange, RendererProjectState } from '@glitch/shared/project/renderer-state.ts';
import type { ProjectVisualModule } from '@glitch/shared/project/types.ts';
import type { VisualModuleCustomParameterId, VisualModuleParameterBindings } from '@glitch/shared/visual-module/types.ts';
import type { FrameScheduler, LiveFrameTiming } from './live-render-loop.ts';
import type { EffectInstanceState } from '@glitch/effect-shared/effect-status.ts';
import type { AudioCaptureMessage, AudioSourceId } from '@glitch/shared/audio.ts';
import type { Asset, IntermediateTextureFormat, Player } from '@glitch/shared/types.ts';
import type { EffectImplementation } from '@glitch/effect-shared/effect-implementation.js';
import type { EffectDefinition } from '@glitch/effect-shared/effect-definition.js';
import type { LIVE_VAR_DEFS } from '@glitch/shared/expression.js';

/**
 * 初期化時に決まっている必要がある設定情報
 */
export type VisualModuleRendererManagerStaticOptions = {
	enable32bitDataTextures: boolean;
	/** 画像の中間テクスチャ形式。Canvas・データ用テクスチャには適用しない。 */
	intermediateTextureFormat: IntermediateTextureFormat;
	enableStats: boolean;
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
	/** 透過非対応の出力用に、乗算済みRGBを黒背景へ合成する。 */
	opaqueOutput: boolean;
	liveTimeFactor: number;
	fpsLimit: number | null;
	assets: Asset[];
	visualModules: ProjectVisualModule[];
};

export type LiveEffectStatusSource = { type: 'live'; instanceId: string; visualModuleId: string };

export type VisualModuleRendererManagerEvents = {
	'outputResolution': (ctx: Resolution) => void;
	'effectState': (ctx: { source: LiveEffectStatusSource; nodeId: string; status: EffectInstanceState | null }) => void;
	'renderError': (ctx: { message: string | null }) => void;
	'telemetry': (ctx: { fpsAverage: number; gpuAverageFast: number; gpuAverageMedium: number; gpuAverageSlow: number; }) => void;
	'gpuMemory': (ctx: { usage: { total: number; textures: number; buffers: number; } }) => void;
};

export class VisualModuleRendererManager extends EventEmitter<{
	'ev': (ctx: { [K in keyof VisualModuleRendererManagerEvents]: { type: K; ctx: Parameters<VisualModuleRendererManagerEvents[K]>[0] } }[keyof VisualModuleRendererManagerEvents]) => void;
}> {
	private previewRenderGeneration = 0;
	private gpuContext: GPUCanvasContext;
	private gpuDevice: GPUDevice;
	private canvasRenderer: CanvasRenderer;
	private fallbackTexture: GPUTexture;
	private outputTextures: OutputTextureResolver;
	private frameScheduler: FrameScheduler;
	private liveRenderLoop: LiveRenderLoop;
	private liveVisualModuleId: ProjectVisualModule['id'] | null = null;
	private liveParamValues: VisualModuleParameterBindings = {};
	private liveParamEvaluator = new ParameterEvaluator();
	private liveVisualModuleRenderer: VisualModuleRenderer | null = null;
	private assetTextures: AssetTextures;
	private videoFrames: Map<Player['id'], VideoFrame> = new Map();
	private videoFrameVersions: Map<Player['id'], number> = new Map();
	private audioSources = new Map<AudioSourceId, AudioHistory>();
	private audioPorts = new Map<AudioSourceId, MessagePort>();
	private timingHelper: TimingHelper;
	private pointerPosition: { x: number; y: number } = { x: -99999, y: -99999 };
	private pointerPositionPrev: { x: number; y: number } = { x: -99999, y: -99999 };
	private effectDefinitions: Record<string, EffectDefinition<any>>;
	private effectImplementations: Record<string, EffectImplementation<any>>;
	private gpuAverageFast = new NonNegativeRollingAverage(10);
	private gpuAverageMedium = new NonNegativeRollingAverage(100);
	private gpuAverageSlow = new NonNegativeRollingAverage(1000);
	private fpsAverage = new NonNegativeRollingAverage(30);
	private telemetryReportIntervalId: number;
	private gpuMemory: GpuMemoryTracker;
	private gpuMemoryReportIntervalId: number;
	private currentRenderError: string | null = null;
	private displayedResolution: Resolution | null = null;

	private readonly staticOptions: VisualModuleRendererManagerStaticOptions;
	private dynamicOptions: VisualModuleRendererManagerDynamicOptions = {
		resolution: { width: 1, height: 1 },
		resolutionScale: 1,
		highlightClipping: false,
		liveTimeFactor: 1.0,
		fpsLimit: null,
		opaqueOutput: false,
		assets: [],
		visualModules: [],
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
	}, staticOptions: VisualModuleRendererManagerStaticOptions) {
		super();

		this.staticOptions = { ...staticOptions };

		this.frameScheduler = coreConfig.frameScheduler ?? browserFrameScheduler;
		this.liveRenderLoop = new LiveRenderLoop({
			scheduler: this.frameScheduler,
			onFrame: timing => {
				// グラフのエラーでWorkerを利用不能にしない。次のフレームで修正後の状態を再試行する。
				try {
					this.renderLiveFrame(timing);
					this.setRenderError(null);
				} catch (error) {
					this.setRenderError(error instanceof Error ? error.message : String(error));
				}
			},
			fpsLimit: this.dynamicOptions.fpsLimit,
			timeFactor: this.dynamicOptions.liveTimeFactor,
		});
		this.gpuDevice = coreConfig.gpuDevice;
		this.assetTextures = new AssetTextures(this.gpuDevice);
		this.outputTextures = new OutputTextureResolver(this.gpuDevice, this.staticOptions.enable32bitDataTextures);
		this.gpuContext = coreConfig.gpuContext;
		this.effectDefinitions = coreConfig.effectDefinitions;
		this.effectImplementations = coreConfig.effectImplementations;

		this.gpuMemory = new GpuMemoryTracker(this.gpuDevice);
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
			format: this.staticOptions.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING,
		});

		this.canvasRenderer = new CanvasRenderer({
			gpuDevice: this.gpuDevice,
			gpuContext: this.gpuContext,
			histogramGpuContext: coreConfig.histogramGpuContext,
			waveformHorizontalGpuContext: coreConfig.waveformHorizontalGpuContext,
			waveformVerticalGpuContext: coreConfig.waveformVerticalGpuContext,
		});

		this.telemetryReportIntervalId = setInterval(() => {
			this.emit('ev', { type: 'telemetry', ctx: {
				fpsAverage: this.fpsAverage.get(),
				gpuAverageFast: this.gpuAverageFast.get(),
				gpuAverageMedium: this.gpuAverageMedium.get(),
				gpuAverageSlow: this.gpuAverageSlow.get(),
			} });
		}, 100);

		this.gpuMemoryReportIntervalId = setInterval(() => {
			this.emit('ev', { type: 'gpuMemory', ctx: { usage: this.gpuMemory.getUsage() } });
		}, 1000);
	}

	// 毎フレーム通知を発生させないように前回から変わっている場合のみ通知
	private setRenderError(message: string | null) {
		if (this.currentRenderError === message) return;
		this.currentRenderError = message;
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
	public async updateDynamicOptions(newOptions: Partial<VisualModuleRendererManagerDynamicOptions>) {
		const { assets, ...synchronousOptions } = newOptions;
		// 通常の設定は呼び出し順に反映する。画像のデコード完了を待ってから反映すると、
		// 後から届いたモジュール編集やFPS変更を古い更新で巻き戻してしまう。
		// Asset一覧だけはテクスチャと同時に切り替えるため、ここではマージしない。
		this.dynamicOptions = { ...this.dynamicOptions, ...synchronousOptions };
		this.canvasRenderer.highlightClipping = this.dynamicOptions.highlightClipping;
		this.canvasRenderer.opaqueOutput = this.dynamicOptions.opaqueOutput;

		if (newOptions.resolution !== undefined || newOptions.resolutionScale !== undefined) {
			this.updateCanvasResolution(scaleResolution(this.dynamicOptions.resolution, this.dynamicOptions.resolutionScale));
			this.liveVisualModuleRenderer?.resize(this.dynamicOptions.resolution, this.dynamicOptions.resolutionScale);
		}
		if (newOptions.fpsLimit !== undefined) {
			this.liveRenderLoop.fpsLimit = newOptions.fpsLimit;
		}
		if (newOptions.liveTimeFactor !== undefined) {
			this.liveRenderLoop.timeFactor = newOptions.liveTimeFactor;
		}
		if (newOptions.visualModules !== undefined) {
			if (this.liveVisualModuleRenderer != null) {
				const visualModule = this.dynamicOptions.visualModules.find(visualModule => visualModule.id === this.liveVisualModuleId);
				if (visualModule == null) this.stopRenderLoop();
				else this.liveVisualModuleRenderer.updateVisualModule(visualModule);
			}
		}

		const assetsCommitted = assets === undefined ? null : await this.updateAssets(assets);
		return { assetsCommitted };
	}

	public replaceProjectState(state: RendererProjectState) {
		// 全量置換は初期化・復旧の境界。差分更新と違い、同じIDでも履歴を引き継がない。
		this.stopRenderLoop();
		this.dynamicOptions.visualModules = state.visualModules;
	}

	public applyProjectChanges(changes: readonly RendererProjectChange[]) {
		const relevant = changes.filter(change => (change.type === 'node' || change.type === 'visualModule') && 'visualModuleId' in change.target);
		const next = applyRendererProjectChanges({ visualModules: this.dynamicOptions.visualModules, timelineScenes: [] }, relevant);
		this.dynamicOptions.visualModules = next.visualModules;
		const liveChanges = relevant.filter(change => (change.type === 'node' || change.type === 'visualModule')
			&& 'visualModuleId' in change.target && change.target.visualModuleId === this.liveVisualModuleId);
		if (liveChanges.length > 0 && this.liveVisualModuleRenderer != null) {
			const module = next.visualModules.find(module => module.id === this.liveVisualModuleId)!;
			this.liveVisualModuleRenderer.updateVisualModule(module, liveChanges.every(change => change.type === 'node' && canPreserveNodeOutputCache(change.changes)));
		}
	}

	private updateAssets(assets: Asset[]): Promise<boolean> {
		return this.assetTextures.update(assets, () => {
			// 世代管理で採用された更新だけが一覧とキャッシュを切り替える。
			// 中断されたデコードの完了後に、Asset一覧だけを上書きしてはいけない。
			this.dynamicOptions.assets = assets;
			this.liveVisualModuleRenderer?.updateAssets(assets);
		});
	}

	public updateLiveParamValues(paramValues: VisualModuleParameterBindings) {
		this.liveParamValues = paramValues;
	}

	public startLiveRenderLoopFor(visualModuleId: string, paramValues: VisualModuleParameterBindings = {}, statusInstanceId = genId()) {
		this.stopRenderLoop();

		const visualModule = this.dynamicOptions.visualModules.find(g => g.id === visualModuleId);
		if (visualModule == null) return;

		this.liveVisualModuleId = visualModuleId;
		this.liveParamValues = paramValues;
		const statusSource: LiveEffectStatusSource = { type: 'live', instanceId: statusInstanceId, visualModuleId };
		this.liveVisualModuleRenderer = new VisualModuleRenderer({
			gpuDevice: this.gpuDevice,
			fallbackTexture: this.fallbackTexture,
			resolution: this.dynamicOptions.resolution,
			resolutionScale: this.dynamicOptions.resolutionScale,
			enable32bitDataTextures: this.staticOptions.enable32bitDataTextures,
			intermediateTextureFormat: this.staticOptions.intermediateTextureFormat,
			enableStats: this.staticOptions.enableStats,
			timingHelper: this.timingHelper,
			onEffectState: (nodeId, status) => this.emit('ev', { type: 'effectState', ctx: { source: statusSource, nodeId, status } }),
			videoFrames: this.videoFrames,
			videoFrameVersions: this.videoFrameVersions,
			assets: this.dynamicOptions.assets,
			visualModule,
			assetTextures: this.assetTextures.textures,
			audioSources: this.audioSources,
			effectDefinitions: this.effectDefinitions,
			effectImplementations: this.effectImplementations,
		});

		this.liveRenderLoop.start();
	}

	private renderLiveFrame(timing: LiveFrameTiming) {
		if (this.liveVisualModuleRenderer == null) return;
		const generation = ++this.previewRenderGeneration;
		const visualModule = this.dynamicOptions.visualModules.find(module => module.id === this.liveVisualModuleId)!;
		const commandEncoder = this.gpuDevice.createCommandEncoder();

		try {
			const evaluatedParamValues = new Map<VisualModuleCustomParameterId, any>();
			for (const def of visualModule.paramDefs) {
				if (this.liveParamValues[def.id] == null) {
					evaluatedParamValues.set(def.id, validateEnumParameterValue(def, def.defaultValue.value));
					continue;
				}
				evaluatedParamValues.set(def.id, validateEnumParameterValue(def, this.liveParamEvaluator.evaluate(this.liveParamValues[def.id], {
					evaluatedParamValues: null,
					variables: {
						TIME: timing.time / 1000,
						TIME_MS: timing.time,
					} satisfies Record<typeof LIVE_VAR_DEFS[number], unknown>,
					automationGraphs: [],
					time: timing.time,
					endTime: Infinity,
				}, def.dataType.kind === 'enum' ? undefined : genEmptyValue(def)))); // TODO: genEmptyValueを遅延評価したい
			}

			const nodeOutput = this.liveVisualModuleRenderer.render({
				evaluatedParamValues: evaluatedParamValues,
				time: timing.time,
				timeDelta: timing.timeDelta,
				endTime: Infinity,
				pointerPosition: this.pointerPosition,
				pointerPositionPrev: this.pointerPositionPrev,
				isExport: false,
			}, commandEncoder);
			if (nodeOutput == null) return;

			// 定数を表示用に1x1へ変換しても、表示枠の寸法は1x1にしない。
			this.updateCanvasResolution(nodeOutput.kind === 'texture' ? nodeOutput.texture : scaleResolution(this.dynamicOptions.resolution, this.dynamicOptions.resolutionScale));
			const tex = this.outputTextures.resolve(nodeOutput);
			this.canvasRenderer.renderToCanvas(tex, commandEncoder);

			this.pointerPositionPrev = { ...this.pointerPosition };

			this.fpsAverage.addSample(1000 / timing.realTimeDelta);
		} finally {
			// 部分的に描画して失敗しても計測を完了する。未完了のencoderを残すと、
			// 次のフレームでTimingHelperが別のencoderを受け付けず、修正後も復旧できない。
			this.gpuDevice.queue.submit([commandEncoder.finish()]);
			if (this.staticOptions.enableStats) {
				this.timingHelper.getResult().then(gpuTime => {
					this.gpuAverageFast.addSample(gpuTime / 1000);
					this.gpuAverageMedium.addSample(gpuTime / 1000);
					this.gpuAverageSlow.addSample(gpuTime / 1000);
				}).catch(error => {
					if (generation === this.previewRenderGeneration) this.setRenderError(error instanceof Error ? error.message : String(error));
				});
			}
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

	public stopRenderLoop() {
		this.previewRenderGeneration++;
		this.liveRenderLoop.stop();
		this.liveVisualModuleId = null;
		this.liveVisualModuleRenderer?.destroy();
		this.liveVisualModuleRenderer = null;
	}

	public destroy() {
		clearInterval(this.telemetryReportIntervalId);
		clearInterval(this.gpuMemoryReportIntervalId);
		this.stopRenderLoop();
		this.outputTextures.dispose();
		this.assetTextures.dispose();
		for (const id of this.audioPorts.keys()) this.resetAudioSource(id, null);
		for (const frame of this.videoFrames.values()) frame.close();
		this.videoFrames.clear();
		this.videoFrameVersions.clear();
		this.canvasRenderer.destroy();
		this.gpuDevice?.destroy();
	}
}

export async function createManager(options: {
	canvas: OffscreenCanvas;
	histogramCanvas: OffscreenCanvas;
	waveformHorizontalCanvas: OffscreenCanvas;
	waveformVerticalCanvas: OffscreenCanvas;
	staticOptions: VisualModuleRendererManagerStaticOptions;
	dynamicOptions: Partial<VisualModuleRendererManagerDynamicOptions>;
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

	let manager: VisualModuleRendererManager | undefined;
	try {
		const context = options.canvas.getContext('webgpu');
		const histogramContext = options.histogramCanvas.getContext('webgpu');
		const waveformHorizontalContext = options.waveformHorizontalCanvas.getContext('webgpu');
		const waveformVerticalContext = options.waveformVerticalCanvas.getContext('webgpu');
		if (!(context instanceof GPUCanvasContext) || !(histogramContext instanceof GPUCanvasContext) || !(waveformHorizontalContext instanceof GPUCanvasContext) || !(waveformVerticalContext instanceof GPUCanvasContext)) {
			throw new Error('cannot get webgpu context');
		}

		manager = new VisualModuleRendererManager({
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
