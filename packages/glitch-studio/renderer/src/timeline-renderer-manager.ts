import { createTransformTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/transform/transform-timeline-layer.ts';
import { TimelineTransformParameters } from '@gs/subsystems_timeline_shared/layers/transform/transform-parameters.ts';
import { isTimelineRenderLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { flattenTimelineLayers, findTimelineLayer, findTimelineLayerLocation } from '@gs/subsystems_timeline_shared/layer-tree.ts';
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
import { createTimelineCompositor } from '@gs/subsystems_timeline_renderer/timeline-compositor.ts';
import { TimelineCompositingParameters } from '@gs/subsystems_timeline_renderer/timeline-compositing-parameters.ts';
import { isTimelineClipActive } from '@gs/subsystems_timeline_shared/timing.ts';
import { createVideoTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/video/video-timeline-layer.ts';
import { TimelineRenderer } from '@gs/subsystems_timeline_renderer/timeline-renderer.ts';
import { TimelineSceneCamera } from '@gs/subsystems_timeline_shared/scene-camera.ts';
import { isTimelineVisualLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { getTimelinePreviewParent } from '@gs/subsystems_timeline_shared/group-space.ts';
import { timelineImageFrame } from '@gs/subsystems_timeline_renderer/timeline-image.ts';
import { invertTimelineAffine, TIMELINE_IDENTITY, TIMELINE_FRAME } from '@gs/subsystems_timeline_shared/spatial.ts';
import { TimelinePreviewScheduler } from '@gs/subsystems_timeline_renderer/timeline-preview-scheduler.ts';
import defaultVertexShaderCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { CanvasRenderer } from './canvas-renderer.ts';
import { ProjectStateVersions } from './project-state-versions.ts';
import { AssetTextures } from './asset-textures.ts';
import { TimelineAudioInputs } from './timeline-audio-inputs.ts';
import type { TimelineTransformObservation, TimelineTransformPreview } from '@gs/glitch-studio_shared/timeline-transform-preview.ts';
import type { TimelineCompositingObserver } from '@gs/subsystems_timeline_renderer/timeline-compositor.ts';
import type { TimelineMotionBlurCameraCuts, TimelineMotionBlurLoop } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import type { GeneratedSpeech } from '@gs/glitch-studio_shared/voicevox.ts';
import type { TimelineMotionBlurSettings } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import type { VisualModuleTarget } from '@gs/glitch-studio_shared/project/visual-module-target.ts';
import type { RendererProjectChange, RendererProjectState } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import type { ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';
import type { TimelineImage } from '@gs/subsystems_timeline_renderer/timeline-image.ts';
import type { FrameScheduler } from '@gs/subsystems_visual-module_renderer/live-render-loop.ts';
import type { TimelineLayerRenderer } from '@gs/subsystems_timeline_renderer/timeline-renderer.ts';
import type { EffectInstanceState } from '@gs/subsystems_effect_shared/effect-status.ts';
import type { Asset, IntermediateTextureFormat } from '@gs/shared/types.ts';
import type { TimelineScene, TimelineLayer, TimelineVisualModuleLayer, TimelineInlineVisualModuleLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { VisualModule } from '@gs/subsystems_visual-module_shared/types.ts';
import type { EffectImplementation } from '@gs/subsystems_effect_shared/effect-implementation.js';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.js';

/**
 * 初期化時に決まっている必要がある設定情報
 */
export type TimelineRendererManagerStaticOptions = {
	timelineFps: number;
	timelineMotionBlur: TimelineMotionBlurSettings;
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
	generatedSpeech: GeneratedSpeech[];
	visualModules: ProjectVisualModule[];
	timelineScenes: TimelineScene[];
	sceneId: string | null;
	transformObserver: TimelineTransformObservation | null;
	/** UIから送られた状態の世代。既存の更新RPCに同梱し、古い枠の採用を防ぐ。 */
	previewRevision: number;
};

// エフェクトは配置場所を知らず、インスタンスを所有するManagerが通知元を付加する。
export type TimelineLayerStatusSource = {
	type: 'timelineLayer'; instanceId: string; layerId: string; clipId: string; rootSceneId: string; layerPath: string[];
};

export type TimelineRendererManagerEvents = {
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
	private frameRenderer: TimelineFrameRenderer<TimelineImage>;
	private motionBlurAccumulator: ReturnType<typeof createMotionBlurAccumulator> | null = null;
	private motionBlurTiming: { boundaries: number[]; loops: TimelineMotionBlurLoop[]; cameras: TimelineMotionBlurCameraCuts[] } | null = null;
	private resolveSpeech = createSpeechResolver([]);
	private nextTimelineLayerStatusId = 0;
	private previewScheduler = new TimelinePreviewScheduler((time, timeDelta) => this.renderPreviewFrame(time, timeDelta));
	private gpuContext: GPUCanvasContext;
	private gpuDevice: GPUDevice;
	private canvasRenderer: CanvasRenderer;
	private defaultVertexShaderModule: GPUShaderModule;
	private fallbackTexture: GPUTexture;
	private sceneOutput: ReturnType<typeof createSceneOutput> | null = null;
	private assetTextures: AssetTextures;
	private audioInputs = new TimelineAudioInputs();
	private effectDefinitions: Record<string, EffectDefinition<any>>;
	private effectImplementations: Record<string, EffectImplementation<any>>;
	private projectVersions = new ProjectStateVersions();
	private pendingTransformPreview: TimelineTransformPreview | null = null;
	private lastTransformPreview: TimelineTransformPreview | null = null;
	private transformPreviewParameters = new TimelineCompositingParameters();
	private transformPreviewContainerParameters = new TimelineTransformParameters();

	private readonly staticOptions: TimelineRendererManagerStaticOptions;
	private dynamicOptions: TimelineRendererManagerDynamicOptions = {
		resolution: { width: 1, height: 1 },
		resolutionScale: 1,
		outputResolution: null,
		highlightClipping: false,
		opaqueOutput: false,
		assets: [],
		generatedSpeech: [],
		visualModules: [],
		timelineScenes: [],
		sceneId: null,
		transformObserver: null,
		previewRevision: 0,
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
		this.staticOptions = { ...staticOptions, timelineMotionBlur: { ...staticOptions.timelineMotionBlur } };

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

		const camera = new TimelineSceneCamera();
		this.timelineRenderer = new TimelineRenderer<TimelineImage, TimelineLayer>({
			getRenderSpace: (time, isExport, referenceTime) => ({
				parent: TIMELINE_IDENTITY, depth: 0, viewport: TIMELINE_FRAME,
				camera: camera.evaluate(this.dynamicOptions.timelineScenes.find(scene => scene.id === this.dynamicOptions.sceneId)?.layers ?? [], time, isExport,
					scaleResolution(this.sceneBaseResolution, this.dynamicOptions.resolutionScale), referenceTime?.timeMs) }),
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
	}

	private presentOutput(output: TimelineImage) {
		const encoder = this.gpuDevice.createCommandEncoder();
		this.sceneOutput ??= createSceneOutput({
			device: this.gpuDevice,
			vertex: this.defaultVertexShaderModule,
			resolution: this.renderResolution,
			format: this.staticOptions.intermediateTextureFormat,
		});
		this.canvasRenderer.renderToCanvas(this.sceneOutput.render(encoder, output), encoder);
		this.gpuDevice.queue.submit([encoder.finish()]);
	}

	private reportRenderError(message: string) {
		this.emit('ev', { type: 'renderError', ctx: { message } });
	}

	private clearTimelineRenderers(preservePreviewRequests = false) {
		this.frameRenderer.clear();
		this.motionBlurTiming = null;
		this.motionBlurAccumulator?.dispose();
		this.motionBlurAccumulator = null;
		this.previewScheduler.clear(preservePreviewRequests);
		this.previewRenderGeneration++;
		this.timelineRenderer.clear();
		this.sceneOutput?.dispose();
		this.sceneOutput = null;
	}

	// (非workerで)呼び出すときは値を独立した参照にすること！ パフォーマンス上の理由でこちら側ではdeepCloneしません
	public async updateDynamicOptions(newOptions: Partial<TimelineRendererManagerDynamicOptions>) {
		const { assets, ...synchronousOptions } = newOptions;
		if (newOptions.generatedSpeech) {
			this.frameRenderer.clear();
			this.resolveSpeech = createSpeechResolver(newOptions.generatedSpeech);
			this.audioInputs.setGeneratedSpeech(newOptions.generatedSpeech);
		}
		// 通常の設定は呼び出し順に反映する。画像のデコード完了を待ってから反映すると、
		// 後から届いたモジュール編集やFPS変更を古い更新で巻き戻してしまう。
		// Asset一覧だけはテクスチャと同時に切り替えるため、ここではマージしない。
		this.dynamicOptions = { ...this.dynamicOptions, ...synchronousOptions };
		this.canvasRenderer.highlightClipping = this.dynamicOptions.highlightClipping;
		this.canvasRenderer.opaqueOutput = this.dynamicOptions.opaqueOutput;

		// Scene選択・出力解像度のnullは解除要求なので、差分のプロパティの有無で判定する。
		// Partialの差分では省略は変更なし、明示的なnullは解除要求。値の有無ではなくown propertyで判定する。
		if (Object.hasOwn(newOptions, 'resolution') || Object.hasOwn(newOptions, 'resolutionScale') || Object.hasOwn(newOptions, 'visualModules') || Object.hasOwn(newOptions, 'timelineScenes') || Object.hasOwn(newOptions, 'sceneId')) {
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

		const assetsCommitted = Object.hasOwn(newOptions, 'assets') ? await this.updateAssets(assets!) : null;
		return { assetsCommitted };
	}

	public replaceProjectState(state: RendererProjectState, previewRevision = this.dynamicOptions.previewRevision + 1) {
		const resolution = this.resolveProjectOutputResolution(state);
		this.clearTimelineRenderers();
		this.projectVersions = new ProjectStateVersions();
		Object.assign(this.dynamicOptions, state);
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
		this.previewRenderGeneration++;
		this.timelineRenderer.cancelPendingRender();
		this.frameRenderer.cancel();
		this.motionBlurTiming = null;
		this.projectVersions.apply(changes, this.dynamicOptions);
		Object.assign(this.dynamicOptions, next);
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
		return findTimelineLayer(getTimelineScene(this.dynamicOptions.timelineScenes, sceneId).layers, layerId);
	}

	private getLayerVersion(sceneId: string, layer: TimelineLayer, clipId: string | null): string {
		const childId = layer.layerType === 'scene' ? layer.clips.find(clip => clip.id === clipId)!.sceneId : null;
		return JSON.stringify([this.projectVersions.scene(sceneId), this.projectVersions.layer(sceneId, layer.id),
																									childId == null ? 0 : this.projectVersions.scene(childId)]);
	}

	private updateAssets(assets: Asset[]): Promise<boolean> {
		return this.assetTextures.update(assets, () => {
			// 世代管理で採用された更新だけが一覧とキャッシュを切り替える。
			// 中断されたデコードの完了後に、Asset一覧だけを上書きしてはいけない。
			// Assetの準備を待つフレームと最新のシーク要求は、公開後に描画できるので維持する。
			this.clearTimelineRenderers(true);
			this.dynamicOptions.assets = assets;
			this.audioInputs.setAssets(assets);
		});
	}

	/** timeはミリ秒。表示期間中はレイヤーごとのインスタンスと履歴を保持する。 */
	public renderTimelineAt(time: number): Promise<void> {
		return this.previewScheduler.render(time);
	}

	private async renderPreviewFrame(time: number, timeDelta: number): Promise<boolean> {
		const generation = ++this.previewRenderGeneration;
		const request = this.dynamicOptions.transformObserver;
		const location = request?.sceneId === this.dynamicOptions.sceneId ? findTimelineLayerLocation(this.getSceneLayers(), request.layerId) : null;
		const layer = location && !location.layer.isDisabled && !location.ancestors.some(group => group.isDisabled) && isTimelineVisualLayer(location.layer) ? location.layer : null;
		const clip = layer && layer.layerType !== 'group' ? layer.clips.find(clip => isTimelineClipActive(clip, time)) : null;
		const preview: TimelineTransformPreview | null = request ? {
			request, revision: this.dynamicOptions.previewRevision, time, clipId: clip?.id ?? null, geometry: null, outputResolution: null,
		} : null;
		this.pendingTransformPreview = preview;
		try {
			try {
				if (!Number.isFinite(time)) throw new Error('Timeline time must be finite');
				await this.renderFrame(time, false, this.staticOptions.timelineFps, timeDelta);
			} finally {
				// submitはGPUへの実行予約であり、描画完了ではない。最終表示・ブラーの
				// 全サンプルを含めて待ち、重いフレームの後ろにGPU処理を積み重ねない。
				// 途中で失敗・編集による中断が起きても、送信済みの処理は待ち切る。
				await this.gpuDevice.queue.onSubmittedWorkDone();
			}
			// 編集や破棄で無効になったフレームの変形情報を、現在の表示へ反映しない。
			if (generation === this.previewRenderGeneration && preview && this.dynamicOptions.transformObserver === request) {
				// ブラーのサブサンプルごとには通知しない。枠の変形は基準時刻で評価し、
				// 寸法には実際の合成前出力を使う。画像の読み戻し・ハンドル用の再描画は不要。
				const blur = this.staticOptions.timelineMotionBlur;
				if (preview.geometry && layer && blur.enabled && blur.shutterAngle > 0 && blur.samples > 1) {
					const { position, origin, scale, rotation, fitMode } = this.transformPreviewParameters.evaluate({
						time, isExport: false, coordinateSpace: layer.coordinateSpace, mask: layer.mask, paramValues: layer.compositingParamValues, automationGraphs: layer.automationGraphs,
					});
					preview.geometry.transform = { position, origin, scale, rotation, fitMode };
				}
				this.publishTransformPreview(preview);
			}
			return true;
		} catch (error) {
			if (generation === this.previewRenderGeneration) {
				this.reportRenderError(error instanceof Error ? error.message : String(error));
				if (preview != null && this.dynamicOptions.transformObserver === request) this.publishTransformPreview({ ...preview, geometry: null, outputResolution: null });
			}
			return false;
		} finally {
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
			const preview = this.pendingTransformPreview;
			if (!preview || preview.request.sceneId !== sceneId || preview.request.layerId !== layerId || preview.clipId !== clipId) return;
			const location = findTimelineLayerLocation(this.getSceneLayers(), layerId);
			const layer = location?.layer;
			if (!layer || !isTimelineVisualLayer(layer)) return;
			// 文字やグループのframeSizeは配置用の基準枠で、枠外の画素や画素密度の制限を含む
			// 実テクスチャ寸法とは異なる。表示する解像度は実寸を既存の購読通知へ同梱する。
			preview.outputResolution = source.kind === 'texture' ? { width: source.texture.width, height: source.texture.height } : null;
			const evaluate = (entry: Extract<TimelineLayer, { compositingParamValues: unknown }>) => this.transformPreviewParameters.evaluate({
				time: preview.time, isExport: false, coordinateSpace: entry.coordinateSpace, mask: entry.mask, paramValues: entry.compositingParamValues, automationGraphs: entry.automationGraphs });
			const settings = evaluate(layer);
			const camera = new TimelineSceneCamera().evaluate(this.dynamicOptions.timelineScenes.find(scene => scene.id === sceneId)?.layers ?? [], preview.time, false, sceneSize);
			const parent = getTimelinePreviewParent(location.ancestors.map(parent => parent.layerType === 'transform'
				? { transform: this.transformPreviewContainerParameters.evaluate(parent.transformParamValues, parent.automationGraphs, preview.time, false) }
				: { settings: evaluate(parent), compositingMode: parent.compositingMode }), settings, sceneSize,
				{ parent: TIMELINE_IDENTITY, depth: 0, camera, viewport: TIMELINE_FRAME });
			preview.geometry = parent && invertTimelineAffine(parent) ? { sourceSize: timelineImageFrame(source, sceneSize), sceneSize, transform: settings } : null;
			preview.parentGeometries = parent ? [{ sourceSize: sceneSize, sceneSize, transform: { position: [0, 0], origin: [0, 0], scale: [1, 1], rotation: 0, fitMode: 'stretch' }, matrix: parent }] : [];
		};
	}

	/** 専用インスタンスで順番に呼び、フレーム間の履歴と一定の経過時間を保持する。 */
	public async renderTimelineFrame(time: number, timeDelta: number, fps = this.staticOptions.timelineFps): Promise<void> {
		// 書き出しfpsはプロジェクト基準とは別に指定できるため、呼び出し境界で検証する。
		await this.renderFrame(time, true, fps, timeDelta);
	}

	private async renderFrame(time: number, isExport: boolean, fps = this.staticOptions.timelineFps, initialTimeDelta = 0) {
		// Assetとレイヤーの同期は別経路で、Workerもデコード待ち中に次のRPCを処理する。
		// 新しいレイヤーが先に届いてもGPUテクスチャの公開までは評価しない。待機中の
		// 更新・削除は最新の一覧へ追従し、破棄後にはGPUを使用しない。
		while (!this.assetTextures.isReady) {
			if (!await this.assetTextures.waitUntilReady()) return false;
		}
		const settings = this.staticOptions.timelineMotionBlur;
		if (!settings.enabled || settings.shutterAngle === 0 || settings.samples <= 1) {
			// 単発描画ではサンプル配列や露光全体用の中断管理を作らない。
			// 直前の複数サンプル描画が待機中なら、残りの評価・表示も止める。
			this.frameRenderer.cancel();
			return this.timelineRenderer.renderAt(time, this.getSceneLayers(), initialTimeDelta, isExport);
		}
		this.motionBlurTiming ??= this.dynamicOptions.sceneId == null ? { boundaries: [], loops: [], cameras: [] } : {
			boundaries: getTimelineMotionBlurBoundaries(this.dynamicOptions.timelineScenes, this.dynamicOptions.sceneId),
			loops: getTimelineMotionBlurLoops(this.dynamicOptions.timelineScenes, this.dynamicOptions.sceneId),
			cameras: getTimelineMotionBlurCameraCuts(this.dynamicOptions.timelineScenes, this.dynamicOptions.sceneId),
		};
		const times = getTimelineSampleTimes(time, fps, settings, this.motionBlurTiming.boundaries, this.motionBlurTiming.loops, this.motionBlurTiming.cameras);
		return this.frameRenderer.render(time, times, isExport, initialTimeDelta);
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
		return this.dynamicOptions.sceneId == null ? [] : getTimelineScene(this.dynamicOptions.timelineScenes, this.dynamicOptions.sceneId).layers.filter(isTimelineRenderLayer);
	}

	private createTimelineLayer(layer: TimelineLayer, clipId: string | null, layerPath: string[], sceneBaseResolution: Resolution, sceneId = this.dynamicOptions.sceneId!): TimelineLayerRenderer<TimelineImage> {
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
				device: this.gpuDevice, vertex: this.defaultVertexShaderModule, resolution: renderResolution,
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
					device: this.gpuDevice, vertex: this.defaultVertexShaderModule,
					resolution: renderResolution, format: this.staticOptions.intermediateTextureFormat,
					getFont: id => this.dynamicOptions.assets.find(asset => asset.id === id && asset.fileDataType.startsWith('font/'))?.fileData ?? null,
				});
			case 'text':
				return createTextTimelineLayer(layer, {
					onCompositing,
					device: this.gpuDevice, vertex: this.defaultVertexShaderModule,
					resolution: renderResolution, format: this.staticOptions.intermediateTextureFormat,
					getFont: id => this.dynamicOptions.assets.find(asset => asset.id === id && asset.fileDataType.startsWith('font/'))?.fileData ?? null,
				});
			case 'shape':
				return createShapeTimelineLayer(layer, {
					onCompositing,
					device: this.gpuDevice, vertex: this.defaultVertexShaderModule,
					resolution: renderResolution, format: this.staticOptions.intermediateTextureFormat,
				});
			case 'effect': {
				const definition = this.effectDefinitions[layer.effectId];
				const implementation = this.effectImplementations[layer.effectId];
				if (!definition || !implementation) throw new Error(`Effect not found: ${layer.effectId}`);
				const source = this.createLayerStatusSource(layer.id, clipId, layerPath);
				return createEffectTimelineLayer(layer, definition, implementation, {
					onCompositing,
					wgpu: {
						device: this.gpuDevice, defaultVertexShaderModule: this.defaultVertexShaderModule,
						enable32bitDataTextures: this.staticOptions.enable32bitDataTextures, intermediateTextureFormat: this.staticOptions.intermediateTextureFormat },
					fallbackTexture: this.fallbackTexture, resolution: renderResolution, resolutionScale: this.dynamicOptions.resolutionScale,
					assets: this.dynamicOptions.assets, assetTextures: this.assetTextures.textures,
					getAudioInput: (binding, time, isExport) => this.audioInputs.getInput(this.dynamicOptions.timelineScenes, sceneId, layer.id, binding, time, isExport),
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
					reversePlayback: 'sourceInMs' in clip && clip.playbackRate < 0,
					onCompositing,
					device: this.gpuDevice, vertex: this.defaultVertexShaderModule,
					resolution: renderResolution, format: this.staticOptions.intermediateTextureFormat,
					resolutionScale: this.dynamicOptions.resolutionScale,
				});
			}
			case 'scene': {
				const clip = layer.clips.find(clip => clip.id === clipId)!;
				const scene = getTimelineScene(this.dynamicOptions.timelineScenes, clip.sceneId);
				const childBaseResolution = getSceneBaseResolution(scene.resolution, this.dynamicOptions.resolution);
				return createSceneTimelineLayer(() => getTimelineScene(this.dynamicOptions.timelineScenes, scene.id), layer, {
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
			onCompositing: this.createCompositingObserver(sceneId, layer.id, clipId, scaleResolution(sceneBaseResolution, this.dynamicOptions.resolutionScale)),
			device: this.gpuDevice, vertex: this.defaultVertexShaderModule,
			resolution: scaleResolution(sceneBaseResolution, this.dynamicOptions.resolutionScale), format: this.staticOptions.intermediateTextureFormat,
			beginPass: (encoder, descriptor) => encoder.beginRenderPass(descriptor),
		});
		const inputFrame = createSceneOutput({
			device: this.gpuDevice, vertex: this.defaultVertexShaderModule,
			resolution: scaleResolution(sceneBaseResolution, this.dynamicOptions.resolutionScale), format: this.staticOptions.intermediateTextureFormat });
		const instance = createVisualModuleTimelineLayer(getModule, getLayer, {
			getImageInput: input => {
				const encoder = this.gpuDevice.createCommandEncoder();
				const result = inputFrame.renderInput(encoder, input);
				this.gpuDevice.queue.submit([encoder.finish()]);
				return result;
			},
			getAudioInput: (binding, time, isExport) => this.audioInputs.getInput(this.dynamicOptions.timelineScenes, sceneId, layer.id, binding, time, isExport),
			prepare: (context, signal) => renderer.prepare(context, signal),
			render: async (context, layerContext) => {
				const commandEncoder = this.gpuDevice.createCommandEncoder();
				let output: TimelineImage | null = null;
				const gpuTime = 0;
				try {
					output = renderer.render(context, commandEncoder);
					if (output != null) {
						const settings = compositingParameters.evaluate({
							time: layerContext.sceneTimeMs,
							isExport: context.isExport,
							coordinateSpace: getLayer().coordinateSpace, mask: getLayer().mask,
							paramValues: getLayer().compositingParamValues,
							automationGraphs: getLayer().automationGraphs,
						});
						output = compositor.render(commandEncoder, layerContext.input, output, settings, layerContext.renderSpace);
					}
				} finally {
					// 描画途中の例外でもエンコーダーと計測を完了する。
					this.gpuDevice.queue.submit([commandEncoder.finish()]);
				}
				return { output, gpuTime };
			},
			destroy: () => {
				compositor.dispose();
				inputFrame.dispose();
				renderer.destroy();
			},
		});
		return {
			evaluate: (context, signal) => {
				const version = this.projectVersions.module(target);
				if (version.revision !== moduleRevision) {
					renderer.updateVisualModule(getModule(), version.cacheResetRevision <= moduleRevision);
					moduleRevision = version.revision;
				}
				return instance.evaluate(context, signal);
			},
			destroy: () => instance.destroy(),
		};
	}

	public destroy() {
		this.clearTimelineRenderers();
		this.audioInputs.dispose();
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

	let manager: TimelineRendererManager | null = null;
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
		device.addEventListener?.('uncapturederror', event => manager?.emit('ev', { type: 'renderError', ctx: { message: event.error.message } }));
		void device.lost?.then(info => { if (info.reason !== 'destroyed') manager?.emit('ev', { type: 'renderError', ctx: { message: info.message || 'GPU device was lost' } }); });

		await manager.updateDynamicOptions(options.dynamicOptions);

		return manager;
	} catch (error) {
		// 呼び出し元にはまだmanagerを返していないため、ここでリソースを回収する。
		if (manager != null) manager.destroy();
		else device.destroy();
		throw error;
	}
}
