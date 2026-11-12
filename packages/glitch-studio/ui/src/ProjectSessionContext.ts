import type { ImageValueRange, ImageValueScale } from '@gs/shared/utility/image-value-scale.ts';
import { resolveImageAnalysisValueScale } from '@gs/shared/utility/image-analysis.ts';
import type { ImageAnalysisTarget } from '@gs/shared/utility/image-analysis.ts';
import type { PreviewImageAnalysisSettings, PreviewWaveformCanvasSizes } from '@gs/glitch-studio_shared/preview-image-analysis.ts';
import { resolvePreviewAnalysisImageSource } from '@gs/glitch-studio_shared/preview-image-analysis.ts';
import { HighResolutionImageAnalysisController } from './HighResolutionImageAnalysisController.ts';
import { CoalescedAsyncUpdate } from './utility/coalesced-async-update.ts';
import { FULL_PREVIEW_IMAGE_ANALYSIS_VIEWPORT } from '@gs/glitch-studio_shared/preview-image-analysis-viewport.ts';
import type { PreviewImageAnalysisViewport } from '@gs/glitch-studio_shared/preview-image-analysis-viewport.ts';
import type { PreviewWaveformViewports } from '@gs/glitch-studio_shared/preview-waveform-viewport.ts';
import type { PreviewGamutCompressionSettings } from '@gs/glitch-studio_shared/preview-gamut-compression.ts';
import type { PreviewGamutWarningSettings } from '@gs/glitch-studio_shared/preview-gamut-warning.ts';
import type { PreviewImageSource } from '@gs/glitch-studio_shared/preview-image-source.ts';
import { findTimelineLayer, flattenTimelineLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { getVoicevoxRequests } from '@gs/subsystems_timeline_shared/voicevox-requests.ts';
import { getVoicevoxRequestKey, createSpeechResolver } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import { openAudioFile } from '@gs/subsystems_audio_renderer/audio-file.ts';
import { genId } from '@gs/shared/utility/id.ts';

import { getTimelineScenesWithProjectAutomationGraphs } from '@gs/glitch-studio_shared/project/automation-graphs.ts';
import { computed, ref, shallowRef, markRaw, nextTick, watch } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.js';
import { getSceneDuration } from '@gs/subsystems_timeline_shared/scenes.js';
import { deepEqual } from '@gs/shared/utility/deep-equal.js';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.js';
import { getSceneAudioClips } from '@gs/subsystems_timeline_shared/scene-audio.js';
import { VoicevoxGeneration } from './audio/voicevox-generation.ts';
import { AudioOutput } from './audio/audio-output.ts';
import { VisualModuleRendererManagerController } from './VisualModuleRendererManagerController.ts';
import { preferences } from './preferences.ts';
import { TimelineRendererManagerController } from './TimelineRendererManagerController.ts';
import { TimelineAudioPreview } from './audio/timeline-audio-preview.ts';
import { PreviewPlaybackController } from './PreviewPlaybackController.ts';
import { RendererProjectSynchronizer } from './RendererProjectSynchronizer.ts';
import { ProjectRenderValidation } from './ProjectRenderValidation.ts';
import { PreviewRenderEngine } from './PreviewRenderEngine.ts';
import { PreviewParameterEditingController } from './utility/preview-parameter-editing.ts';
import { getImageAnalysisValueRange } from './utility/image-analysis-range.ts';
import type { ImageAnalysisRangePreset } from './utility/image-analysis-range.ts';
import { ProjectSaveController } from './ProjectSaveController.ts';
import type { ProjectFileOperationController } from './ProjectFileOperationController.ts';
import { getRendererAssets } from './utility/renderer-assets.ts';
import { resolveExternalAssets } from './external-assets.ts';
import { getTimelineEditorState, getSelectedTimelineLayerId } from './utility/timeline-editor-state.ts';
import type { TimelineClipboard } from './utility/timeline-editor-state.ts';
import type { WorkspacePanelRevealRequest } from './utility/workspace-panel-reveal.ts';
import type { GeneratedSpeech } from '@gs/glitch-studio_shared/voicevox.ts';
import type { VoicevoxSpeaker } from '@gs/glitch-studio_shared/voicevox.ts';
import type { ProjectFileHandle } from './gsproj.ts';
import type { ProjectContext } from './Project.ts';
import type { TimelineRendererManagerDynamicOptions } from '@gs/glitch-studio_renderer/timeline-renderer-manager.ts';
import type { VisualModuleRendererManagerDynamicOptions } from '@gs/glitch-studio_renderer/visual-module-renderer-manager.ts';
import { i18n } from '@/i18n.ts';
import * as ui from '@/ui.ts';

const DEFAULT_TIMELINE_PREVIEW_MOTION_BLUR_SAMPLES = 0;

export const TIMELINE_PREVIEW_MOTION_BLUR_SAMPLE_OPTIONS = [0, 2, 4, 8] as const;

export class ProjectSessionContext {
	public readonly id: string;
	// プロジェクト外への参照を貼り付けないよう、内部クリップボードもセッションに閉じる。
	public readonly timelineClipboard = shallowRef<TimelineClipboard | null>(null);
	public readonly workspacePanelRevealRequest = shallowRef<WorkspacePanelRevealRequest | null>(null);
	private disposed = false;
	private startupStarted = false;
	private disposal: Promise<void> | null = null;
	private readonly sessionDisposers: (() => void)[] = [];
	public get isDisposed() { return this.disposed; }
	private readonly onWindowFocus = () => {
		if (!this.disposed) void resolveExternalAssets(this.projectContext.stateManager.state.assets.value);
	};
	private synchronizedPreviewDisplayMode: 'visualModuleLivePreview' | 'timeline' | null = null;
	public readonly previewParameterEditing = markRaw(new PreviewParameterEditingController());
	public readonly projectContext: ProjectContext;
	public activeSceneId: Ref<string | null>;
	public timelineEvaluationScenes = computed(() => getTimelineScenesWithProjectAutomationGraphs(
		this.projectContext.stateManager.state.timelineScenes.value, this.projectContext.stateManager.state.automationGraphs.value,
	));
	public activeScene = computed(() => this.projectContext.stateManager.state.timelineScenes.value.find(scene => scene.id === this.activeSceneId.value) ?? null);
	public selectedTimelineLayer = computed(() => {
		const scene = this.activeScene.value;
		if (scene == null) return null;
		const layerId = getSelectedTimelineLayerId(getTimelineEditorState(scene).selection);
		return (layerId == null ? null : findTimelineLayer(scene.layers, layerId)) ?? null;
	});
	public visualModuleLivePreviewFpsLimit = ref<number | null>(60);
	public timelinePreviewFpsFactor = ref(0.5);
	public timelinePreviewMotionBlurSamples = ref<(typeof TIMELINE_PREVIEW_MOTION_BLUR_SAMPLE_OPTIONS)[number]>(DEFAULT_TIMELINE_PREVIEW_MOTION_BLUR_SAMPLES);
	public visualModuleLivePreviewTimeFactor = ref(1);
	public resolutionFactor: Ref<number>;
	public highlightClipping = ref(false);
	/** 警告の判定対象だけを切り替え、作品・解析・保存データは変更しない。 */
	public previewWarningImageSource = ref<PreviewImageSource>('original');
	/** 判定色域も両プレビューで共有し、プロジェクトや環境設定には保存しない。 */
	public previewGamutWarning = shallowRef<PreviewGamutWarningSettings>({ enabled: false, referenceGamut: 'srgb', bounds: 'unit' });
	/** 作品・保存データとは独立した、両プレビュー共通の表示用露出（EV）。 */
	public previewExposure = ref(0);
	/** 両プレビュー共通のsRGB確認。作品・保存データを変更せず、色域圧縮の設定値も保持する。 */
	public previewSrgbProof = ref(false);
	/** カスタム量はモード切替でも保持する。変更はオブジェクトを置き換えて両Workerへ同期する。 */
	public previewGamutCompression = shallowRef<PreviewGamutCompressionSettings>({ mode: 'none', customAmount: 0.5 });
	public analysisValueScale = ref<ImageValueScale>('srgb');
	public analysisTarget = ref<ImageAnalysisTarget>('rgb');
	/** RGB以外では元画像へ固定するが、RGBへ戻った際の選択値は保持する。 */
	public analysisImageSource = ref<PreviewImageSource>('original');
	public analysisRangePreset = ref<ImageAnalysisRangePreset>('zeroToOne');
	public analysisCustomRange = ref<ImageValueRange>({ minimum: 0, maximum: 1 });
	public analysisValueRange = computed(() => getImageAnalysisValueRange(this.analysisRangePreset.value, this.analysisCustomRange.value));
	public readonly highResolutionImageAnalysis: HighResolutionImageAnalysisController<VisualModuleRendererManagerController | TimelineRendererManagerController>;
	public readonly analysisWaveformCanvasSizes = shallowRef<PreviewWaveformCanvasSizes | null>(null);
	public readonly analysisWaveformViewports = shallowRef<PreviewWaveformViewports | null>(null);
	public readonly analysisHistogramViewport = shallowRef<ImageValueRange | null>(null);
	private readonly displayedWaveformViewports = shallowRef<PreviewWaveformViewports | null>(null);
	private readonly displayedHistogramViewport = shallowRef<ImageValueRange | null>(null);
	private readonly imageAnalysisDisplayUpdate: CoalescedAsyncUpdate;
	public readonly imageAnalysisSettings = computed<PreviewImageAnalysisSettings>(() => ({ target: this.analysisTarget.value, valueScale: this.analysisValueScale.value,
		imageSource: resolvePreviewAnalysisImageSource(this.analysisTarget.value, this.analysisImageSource.value),
		imageAdjustments: { exposure: this.previewExposure.value, srgbProof: this.previewSrgbProof.value, gamutCompression: { ...this.previewGamutCompression.value } },
		valueRange: { ...this.analysisValueRange.value }, waveformCanvasSizes: this.analysisWaveformCanvasSizes.value, waveformViewports: this.analysisWaveformViewports.value, histogramViewport: this.analysisHistogramViewport.value }));
	public readonly displayedImageAnalysisSettings = computed(() => this.highResolutionImageAnalysis.displayedSettings.value ?? { ...this.imageAnalysisSettings.value, waveformViewports: this.displayedWaveformViewports.value, histogramViewport: this.displayedHistogramViewport.value });
	public readonly imageAnalysisRenderer = computed(() => this.highResolutionImageAnalysis.source.value ?? this.activePreviewRenderer.value);
	public readonly imageAnalysisAvailable = computed(() => preferences.r.analysisMonitorsEnabled.value && !this.renderEngine.isSuspended.value && this.activePreviewRenderer.value.isReady.value);
	public audioOutput = markRaw(new AudioOutput());
	public visualModuleRendererManagerController: VisualModuleRendererManagerController;
	public timelineRendererManagerController: TimelineRendererManagerController;
	public timelineAudioPreview: TimelineAudioPreview;
	public previewPlayback: PreviewPlaybackController;
	public readonly voicevoxGeneration: VoicevoxGeneration;
	public readonly voicevoxConnection = { endpoint: ref('http://127.0.0.1:50021'), version: ref(''), speakers: ref<VoicevoxSpeaker[]>([]) };
	private readonly previewSpeech: ShallowRef<GeneratedSpeech[]>;
	private pendingSceneSeek: number | null = null;
	private scenePlaybackTimes = new Map<string, number>();
	public readonly renderValidation: ProjectRenderValidation;
	public readonly renderEngine: PreviewRenderEngine;
	private readonly rendererProjectSynchronizer: RendererProjectSynchronizer;
	private readonly projectSaveController: ProjectSaveController;
	public activePreviewRenderer = computed(() => this.previewPlayback.state.value.mode === 'visualModuleLivePreview' ? this.visualModuleRendererManagerController : this.timelineRendererManagerController);
	public get projectFileName() { return this.projectSaveController.projectFileName; }
	public get projectFileHandle() { return this.projectSaveController.projectFileHandle; }
	public get hasUnsavedChanges() { return this.projectSaveController.hasUnsavedChanges; }
	public get isProjectSaving() { return this.projectSaveController.isProjectSaving; }
	public get projectBackupAccess() { return this.projectSaveController.projectBackupAccess; }
	public get projectBackupStatus() { return this.projectSaveController.projectBackupStatus; }

	constructor(projectContext: ProjectContext, options: {
		id: string;
		fileName: string | null;
		fileHandle: ProjectFileHandle | null;
		fileOperations: ProjectFileOperationController;
		checkSaveDestination: (handle: ProjectFileHandle) => Promise<void>;
	}) {
		this.id = options.id;
		markRaw(this);
		this.projectContext = projectContext;
		const state = projectContext.stateManager.state;
		// 初期値は購読前に決める。初回のScene選択を切替操作として扱わず、生成音声も最初の起動から渡す。
		this.activeSceneId = ref(state.timelineScenes.value[0]?.id ?? null);
		this.previewSpeech = shallowRef(deepClone(state.generatedSpeech.value));
		const maxDimension = Math.max(state.resolution.value.width, state.resolution.value.height);
		this.resolutionFactor = ref(maxDimension > 3000 ? 0.25 : maxDimension > 1500 ? 0.5 : 1);
		this.renderValidation = markRaw(new ProjectRenderValidation(state, effectDefinitions));
		this.renderValidation.reset();

		// 保存済みのAnalyze設定をWorker生成より先に渡す。切り替え時も、映像レンダラーの
		// 再生成を待たず音声モニターを止める。音声再生・作品内の音声解析には適用しない。
		this.sessionDisposers.push(watch(preferences.r.analysisMonitorsEnabled, enabled => {
			void this.audioOutput.preview.setAnalysisEnabled(enabled);
		}, { immediate: true, flush: 'sync' }));

		// Sceneを削除・Undoした場合にも、UIが存在しないSceneを編集し続けないようにする。
		this.sessionDisposers.push(watch(() => this.projectContext.stateManager.state.timelineScenes.value.map(scene => scene.id), ids => {
			if (this.activeSceneId.value == null || !ids.includes(this.activeSceneId.value)) this.activeSceneId.value = ids[0] ?? null;
		}, { flush: 'sync' }));

		this.visualModuleRendererManagerController = markRaw(new VisualModuleRendererManagerController(this.audioOutput));
		this.timelineRendererManagerController = markRaw(new TimelineRendererManagerController());

		this.timelineAudioPreview = markRaw(new TimelineAudioPreview(
			() => this.audioOutput.getOutput(),
			() => ({
				generatedSpeech: this.previewSpeech.value,
				assets: deepClone(this.projectContext.stateManager.state.assets.value),
				timelineScenes: deepClone(this.timelineEvaluationScenes.value),
				sceneId: this.activeSceneId.value,
			}),
		));

		this.previewPlayback = markRaw(new PreviewPlaybackController(
			this.visualModuleRendererManagerController,
			this.timelineRendererManagerController,
			() => this.projectContext.stateManager.state.timelineFps.value * this.timelinePreviewFpsFactor.value,
			() => this.activeScene.value == null ? 0 : getSceneDuration(this.activeScene.value),
			this.timelineAudioPreview,
			(visualModuleId, params) => {
				this.renderValidation.setVisualModuleLivePreviewInputs(visualModuleId, params);
				this.renderEngine.setValidationError(this.renderValidation.errorMessage.value);
				this.renderEngine.notifyContentChange();
			},
		));
		this.sessionDisposers.push(watch(() => JSON.stringify([this.previewPlayback.state.value.mode, this.previewPlayback.visualModuleLivePreviewVisualModuleId.value, this.activeSceneId.value]),
			() => this.previewParameterEditing.clear(), { flush: 'sync' }));
		this.renderEngine = markRaw(new PreviewRenderEngine({
			dispose: reason => {
				this.highResolutionImageAnalysis?.reset();
				this.imageAnalysisDisplayUpdate?.clear();
				this.displayedWaveformViewports.value = this.analysisWaveformViewports.value;
				this.displayedHistogramViewport.value = this.analysisHistogramViewport.value;
				this.synchronizedPreviewDisplayMode = null;
				this.previewPlayback.suspend();
				this.visualModuleRendererManagerController.disposeManager(reason);
				this.timelineRendererManagerController.disposeManager(reason);
			},
			create: async isCurrent => {
				if (!isCurrent()) return;
				// 初回・設定変更・復旧で同じ境界から取得する。awaitを挟まず両プレビュー分を固定し、
				// 送信後の編集は差分を予約せず、この生成自体を破棄して取り込み直す。
				const state = this.projectContext.stateManager.state;
				const staticOptions = this.getPreviewStaticOptions();
				const previewDisplayMode = this.previewPlayback.state.value.mode;
				const snapshot = deepClone({
					assets: getRendererAssets(state.assets.value), players: state.players.value, customShaderEffects: state.customShaderEffects.value,
					project: { automationGraphs: state.automationGraphs.value, visualModules: state.visualModules.value, timelineScenes: state.timelineScenes.value },
					commonOptions: { resolution: { ...state.resolution.value }, resolutionScale: this.resolutionFactor.value, highlightClipping: this.highlightClipping.value,
						previewWarningImageSource: this.previewWarningImageSource.value, previewGamutWarning: { ...this.previewGamutWarning.value }, previewExposure: this.previewExposure.value, previewSrgbProof: this.previewSrgbProof.value, previewGamutCompression: { ...this.previewGamutCompression.value },
						previewBackground: preferences.s.animatedBgInPreview ? 'checker' as const : 'black' as const, analysisValueScale: this.analysisValueScale.value, analysisTarget: this.analysisTarget.value, analysisImageSource: this.analysisImageSource.value, analysisValueRange: { ...this.analysisValueRange.value }, analysisWaveformCanvasSizes: this.analysisWaveformCanvasSizes.value, analysisWaveformViewports: this.analysisWaveformViewports.value, analysisHistogramViewport: this.analysisHistogramViewport.value },
					visualModuleOptions: { previewActive: previewDisplayMode === 'visualModuleLivePreview', fpsLimit: this.visualModuleLivePreviewFpsLimit.value, visualModuleLivePreviewTimeFactor: this.visualModuleLivePreviewTimeFactor.value },
					timelineOptions: { previewActive: previewDisplayMode === 'timeline', sceneId: this.activeSceneId.value, generatedSpeech: this.previewSpeech.value,
						previewFps: state.timelineFps.value * this.timelinePreviewFpsFactor.value },
				});
				this.synchronizedPreviewDisplayMode = previewDisplayMode;
				const results = await Promise.allSettled([
					this.visualModuleRendererManagerController.initialize({
						staticOptions: staticOptions.visualModule,
						dynamicOptions: { ...snapshot.commonOptions, ...snapshot.visualModuleOptions,
							automationGraphs: snapshot.project.automationGraphs, visualModules: snapshot.project.visualModules },
						resources: { assets: snapshot.assets, players: snapshot.players, customShaderEffects: snapshot.customShaderEffects },
					}),
					isCurrent() ? this.timelineRendererManagerController.initialize({
						staticOptions: staticOptions.timeline,
						dynamicOptions: { ...snapshot.project, ...snapshot.commonOptions, ...snapshot.timelineOptions },
						resources: { assets: snapshot.assets, customShaderEffects: snapshot.customShaderEffects },
					}) : Promise.resolve(),
				]);
				const failure = results.find(result => result.status === 'rejected');
				if (failure?.status === 'rejected') throw failure.reason;
			},
			onReady: () => {
				this.displayedWaveformViewports.value = this.analysisWaveformViewports.value;
				this.displayedHistogramViewport.value = this.analysisHistogramViewport.value;
				// 初期化中の表示切替も、現在の再生状態から同期してから描画を再開する。
				void this.updatePreviewDisplayActivity();
				this.previewPlayback.resume();
			},
		}));
		this.renderEngine.setValidationError(this.renderValidation.errorMessage.value);
		this.highResolutionImageAnalysis = markRaw(new HighResolutionImageAnalysisController({
			setLivePaused: async paused => {
				await this.updatePreviewOptions({ analysisPaused: paused, analysisTarget: this.analysisTarget.value, analysisImageSource: this.analysisImageSource.value, analysisValueScale: this.analysisValueScale.value, analysisValueRange: { ...this.analysisValueRange.value }, analysisWaveformCanvasSizes: this.analysisWaveformCanvasSizes.value, analysisWaveformViewports: this.analysisWaveformViewports.value, analysisHistogramViewport: this.analysisHistogramViewport.value });
				if (!paused) {
					this.displayedWaveformViewports.value = this.analysisWaveformViewports.value;
					this.displayedHistogramViewport.value = this.analysisHistogramViewport.value;
				}
			},
			refreshLive: () => this.previewPlayback.refresh(),
			onError: error => this.renderEngine.fail(error),
		}));
		this.imageAnalysisDisplayUpdate = new CoalescedAsyncUpdate(async () => {
			await this.renderEngine.runRendererUpdate(async () => {
				if (this.highResolutionImageAnalysis.active.value) return;
				const settings = { waveformCanvasSizes: this.analysisWaveformCanvasSizes.value, waveformViewports: this.analysisWaveformViewports.value, histogramViewport: this.analysisHistogramViewport.value };
				const source = this.activePreviewRenderer.value;
				const revision = source.canvasRevision.value;
				await Promise.all([
					this.visualModuleRendererManagerController.setImageAnalysisDisplay(settings, source === this.visualModuleRendererManagerController),
					this.timelineRendererManagerController.setImageAnalysisDisplay(settings, source === this.timelineRendererManagerController),
				]);
				if (!this.highResolutionImageAnalysis.active.value && source === this.activePreviewRenderer.value && revision === source.canvasRevision.value) {
					this.displayedWaveformViewports.value = settings.waveformViewports;
					this.displayedHistogramViewport.value = settings.histogramViewport;
				}
			}, { waitForInitialization: true });
		}, error => this.renderEngine.fail(error));
		this.sessionDisposers.push(watch(() => this.previewPlayback.state.value.mode, () => {
			void this.updatePreviewDisplayActivity();
		}, { flush: 'sync' }));
		for (const controller of [this.visualModuleRendererManagerController, this.timelineRendererManagerController]) {
			controller.onRenderFailure = (error, origin) => {
				this.renderEngine.fail(error, origin);
				void resolveExternalAssets(this.projectContext.stateManager.state.assets.value);
			};
		}
		window.addEventListener?.('focus', this.onWindowFocus);
		this.visualModuleRendererManagerController.onAssetReadFailure = () => {
			void resolveExternalAssets(this.projectContext.stateManager.state.assets.value);
		};
		this.sessionDisposers.push(watch(this.previewPlayback.visualModuleLivePreviewVisualModuleId, id => {
			if (id != null) return;
			this.renderValidation.setVisualModuleLivePreviewInputs(null);
			this.renderEngine.setValidationError(this.renderValidation.errorMessage.value);
		}, { flush: 'sync' }));
		this.sessionDisposers.push(watch(() => this.timelineAudioPreview.error.value, message => {
			if (message != null) {
				this.renderEngine.fail(new Error(message));
				void resolveExternalAssets(this.projectContext.stateManager.state.assets.value);
			}
		}));
		this.sessionDisposers.push(projectContext.stateManager.onChange(changes => {
			this.renderValidation.update(changes);
			this.renderEngine.setValidationError(this.renderValidation.errorMessage.value);
			if (changes.some(change => change.type === 'customShaderEffect')) {
				// 全量更新を起動後に送るため、初期化中でもWorkerを破棄しない。エラー中は従来どおり再生成する。
				this.renderEngine.requestRetry();
			} else if (changes.some(change => ['automationGraphs', 'node', 'visualModule', 'visualModuleRegistration', 'layer', 'layerTree', 'layerOrder', 'scene'].includes(change.type))) {
				this.renderEngine.notifyContentChange();
			}
		}));

		this.voicevoxGeneration = markRaw(new VoicevoxGeneration({
			getScenes: () => this.projectContext.stateManager.state.timelineScenes.value,
			getSpeech: () => this.projectContext.stateManager.state.generatedSpeech.value,
			setSpeech: speech => { this.projectContext.stateManager.state.generatedSpeech.value = speech; },
			synthesize: async request => {
				if (!window.desktop) throw new Error('VOICEVOX generation requires the Electron app.');
				const result = await window.desktop.voicevoxSynthesize(request);
				const fileData = new Blob([new Uint8Array(result.data)], { type: 'audio/wav' });
				const audio = await openAudioFile(fileData);
				try {
					return {
						key: getVoicevoxRequestKey(request),
						sourceId: genId(),
						durationMs: audio.durationSeconds * 1000,
						fileData,
						engineVersion: result.engineVersion,
						audioQuery: result.audioQuery,
					};
				} finally { audio.dispose(); }
			},
		}));

		// 再生中は生成結果を採用しない。シークで音声Workerを再作成してもこの一覧を使う。
		this.sessionDisposers.push(watch([this.previewPlayback.isTimelinePlaying, this.projectContext.stateManager.state.generatedSpeech], ([playing], previous) => {
			if (!playing || !previous?.[0]) {
				const speech = this.projectContext.stateManager.state.generatedSpeech.value;
				// 配列だけのコピーでは各音声・AudioQueryにVueのProxyが残り、音声Workerの
				// postMessageが失敗する。ここで入れ子まで通常の値にし、再生中の一覧を固定する。
				if (speech.length !== this.previewSpeech.value.length || speech.some((item, index) => item.sourceId !== this.previewSpeech.value[index]?.sourceId)) this.previewSpeech.value = deepClone(speech);
			}
		}, { flush: 'sync' }));
		this.sessionDisposers.push(watch(this.previewSpeech, speech => {
			void this.updateTimelinePreviewOptions({ generatedSpeech: deepClone(speech) }).then(() => this.previewPlayback.refresh()).catch(error => {
				ui.alert({ type: 'error', text: String(error) });
				console.error(error);
			});
		}, { flush: 'sync' }));

		this.sessionDisposers.push(watch(this.activeSceneId, (sceneId, previousId) => {
			this.renderEngine.notifyContentChange();
			// 音声更新のwatchより前に旧Sceneの時計を止め、切替先の長さで位置を丸めない。
			this.previewPlayback.pauseTimeline();
			if (previousId != null) this.scenePlaybackTimes.set(previousId, this.previewPlayback.currentTimelineTime.value);
			this.pendingSceneSeek = sceneId == null ? 0 : this.scenePlaybackTimes.get(sceneId) ?? 0;
		}, { flush: 'sync' }));

		this.sessionDisposers.push(watch(this.highlightClipping, async value => {
			await this.updatePreviewOptions({ highlightClipping: value });
			this.previewPlayback.refresh();
		}, { flush: 'sync' }));
		this.sessionDisposers.push(watch(this.previewWarningImageSource, async value => {
			await this.updatePreviewOptions({ previewWarningImageSource: value });
			this.previewPlayback.refresh();
		}, { flush: 'sync' }));
		this.sessionDisposers.push(watch(this.previewGamutWarning, async value => {
			await this.updatePreviewOptions({ previewGamutWarning: { ...value } });
			this.previewPlayback.refresh();
		}, { flush: 'sync' }));
		this.sessionDisposers.push(watch(preferences.r.animatedBgInPreview, async value => {
			await this.updatePreviewOptions({ previewBackground: value ? 'checker' : 'black' });
			this.previewPlayback.refresh();
		}, { flush: 'sync' }));

		this.sessionDisposers.push(watch([this.analysisTarget, this.analysisValueScale, this.analysisValueRange, this.analysisImageSource], async ([target, valueScale, valueRange, imageSource]) => {
			const resolvedValueScale = resolveImageAnalysisValueScale(target, valueScale);
			if (resolvedValueScale !== valueScale) {
				// 同期watchへ再入して、有効な対象・範囲の組だけをRendererへ渡す。
				this.analysisValueScale.value = resolvedValueScale;
				return;
			}
			if (this.highResolutionImageAnalysis.active.value) {
				this.highResolutionImageAnalysis.update(this.imageAnalysisSettings.value);
				return;
			}
			await this.updatePreviewOptions({ analysisTarget: target, analysisImageSource: imageSource, analysisValueScale: valueScale, analysisValueRange: { ...valueRange } });
			this.previewPlayback.refresh();
		}, { flush: 'sync' }));

		this.sessionDisposers.push(watch([this.analysisWaveformCanvasSizes, this.analysisWaveformViewports, this.analysisHistogramViewport, this.activePreviewRenderer], () => {
			if (this.highResolutionImageAnalysis.active.value) {
				this.highResolutionImageAnalysis.update(this.imageAnalysisSettings.value);
				return;
			}
			this.imageAnalysisDisplayUpdate.request();
		}, { flush: 'sync' }));

		this.sessionDisposers.push(watch(this.previewExposure, async value => {
			await this.updatePreviewOptions({ previewExposure: value });
			this.refreshHeldDisplayAnalysis();
			this.previewPlayback.refresh();
		}, { flush: 'sync' }));
		this.sessionDisposers.push(watch(this.previewSrgbProof, async value => {
			await this.updatePreviewOptions({ previewSrgbProof: value });
			this.refreshHeldDisplayAnalysis();
			this.previewPlayback.refresh();
		}, { flush: 'sync' }));
		this.sessionDisposers.push(watch(this.previewGamutCompression, async value => {
			await this.updatePreviewOptions({ previewGamutCompression: { ...value } });
			this.refreshHeldDisplayAnalysis();
			this.previewPlayback.refresh();
		}, { flush: 'sync' }));

		this.sessionDisposers.push(watch(this.visualModuleLivePreviewFpsLimit, async value => {
			await this.updateVisualModulePreviewOptions({ fpsLimit: value });
		}, { flush: 'sync' }));

		this.sessionDisposers.push(watch(this.visualModuleLivePreviewTimeFactor, async value => {
			await this.updateVisualModulePreviewOptions({ visualModuleLivePreviewTimeFactor: value });
		}, { flush: 'sync' }));
		this.sessionDisposers.push(watch([this.projectContext.stateManager.state.timelineFps, this.timelinePreviewFpsFactor], async () => {
			await this.updateTimelinePreviewOptions({ previewFps: this.projectContext.stateManager.state.timelineFps.value * this.timelinePreviewFpsFactor.value });
			this.previewPlayback.updateTimelinePreviewFps();
		}, { flush: 'sync' }));

		this.sessionDisposers.push(watch([this.projectContext.stateManager.state.resolution, this.resolutionFactor], async () => {
			await this.updatePreviewOptions({
				resolution: { ...this.projectContext.stateManager.state.resolution.value },
				resolutionScale: this.resolutionFactor.value,
			});
			this.previewPlayback.refresh();
		}, { flush: 'sync' }));

		this.sessionDisposers.push(watch(() => this.getPreviewStaticOptions(), (options, previous) => {
			// 同値の再代入を除き、Timeline固有の設定も両プレビューを同じ世代として再生成する。
			if (!deepEqual(options, previous)) this.renderEngine.requestRestart();
		}, { flush: 'sync' }));

		// 編集状態の購読は生成時に揃え、起動待ちの間の変更と終了にも同じ寿命で対応する。
		// 発話編集・削除・Undo/Redoでは、旧音声と新字幕を混在させず再生を停止する。
		this.sessionDisposers.push(watch(() => JSON.stringify(this.projectContext.stateManager.state.timelineScenes.value.map(scene => ({
			id: scene.id,
			layers: flattenTimelineLayers(scene.layers).filter(layer => layer.layerType === 'voicevox').map(layer => ({
				id: layer.id,
				voicevox: layer.voicevox,
				utterances: layer.utterances,
				clips: layer.clips,
				isDisabled: layer.isDisabled,
			})),
		}))), () => { if (this.previewPlayback.isTimelinePlaying.value) this.previewPlayback.pauseTimeline(); }, { flush: 'sync' }));

		// 音声の内容・参照先・ループ長を比較し、映像パラメータの編集では先読みPCMを維持する。
		// 素材原本の変更は下の同期watchがプレビュー全体を再生成し、再開時に最新素材で音声も作り直す。
		this.sessionDisposers.push(watch(() => {
			const layers = this.renderValidation.errorMessage.value || this.activeSceneId.value == null ? [] : getSceneAudioClips(this.timelineEvaluationScenes.value, this.activeSceneId.value, { type: 'all' }, createSpeechResolver(this.previewSpeech.value));
			return {
				layers: deepClone(layers),
				duration: this.activeScene.value == null ? 0 : getSceneDuration(this.activeScene.value),
			};
		}, (next, previous) => {
			if (next.duration !== previous.duration || !deepEqual(next.layers, previous.layers)) {
				this.previewPlayback.refreshAudio();
			}
		}));

		const previewResources = computed<(string | number | boolean | Blob | null | undefined)[][]>(previous => {
			// Blobは不変なので同一性で、URL入力は値で比較する。履歴のメタデータ復元は同値の
			// オブジェクトも再代入するため、その通知や名前・サムネイルだけの変更では再生成しない。
			const next = [
				...state.assets.value.map(asset => [
					'asset', asset.id, asset.fileDataType, asset.width, asset.height, asset.hash,
					asset.isExternalReference, asset.sourceFilePath,
					...(asset.fileData instanceof Blob ? [asset.fileData] : [asset.fileData.url, asset.fileData.size, asset.fileData.error]),
				]),
				...state.players.value.map(player => ['player', player.id, player.sourceType, player.assetId]),
			];
			return previous != null && next.length === previous.length && next.every((resource, index) =>
				resource.length === previous[index].length && resource.every((value, field) => value === previous[index][field])) ? previous : next;
		});
		this.sessionDisposers.push(watch(previewResources, async (_value, _previous, onCleanup) => {
			// 同じCommandが追加するノードの差分より先に止める。await後では旧素材で解像度を計算してしまう。
			const update = this.renderEngine.beginResourceUpdate();
			onCleanup(update.cancel);
			try {
				// 同期watchはCommandの途中にも呼ばれるため、最終状態になってから参照解決する。
				await Promise.resolve();
				if (!update.isCurrent()) return;
				await resolveExternalAssets(state.assets.value);
				if (!update.isCurrent()) return;
				// 準備中の編集差分は再送せず、再生成経路が素材・Player・ノードの最新状態を取り込む。
				await update.complete();
			} catch (error) {
				if (!update.isCurrent()) return;
				update.cancel();
				this.renderEngine.fail(error);
			}
		}, { flush: 'sync' }));

		// UndoでVisual Module Live Preview対象が取り除かれたら、復旧や再初期化で存在しないVisual Moduleを再生しない。
		this.sessionDisposers.push(this.projectContext.stateManager.onChange(changes => {
			this.previewPlayback.cancelTimelineBake();
			const visualModuleLivePreviewVisualModuleId = this.previewPlayback.visualModuleLivePreviewVisualModuleId.value;
			if (visualModuleLivePreviewVisualModuleId != null && changes.some(change => change.type === 'visualModuleRegistration' && change.visualModuleId === visualModuleLivePreviewVisualModuleId)
				&& this.projectContext.getVisualModuleById(visualModuleLivePreviewVisualModuleId) == null) this.previewPlayback.showTimeline();
		}));

		this.rendererProjectSynchronizer = new RendererProjectSynchronizer(this.projectContext.stateManager, {
			apply: changes => this.renderEngine.runRendererUpdate(() => Promise.all([
				this.visualModuleRendererManagerController.applyProjectChanges(changes),
				this.timelineRendererManagerController.applyProjectChanges(changes),
			]), { waitForInitialization: changes.some(change => change.type === 'customShaderEffects') }),
			onUpdated: () => this.previewPlayback.refresh(),
			onError: error => {
				if (this.renderEngine.canRender.value) this.renderEngine.fail(error);
			},
		});
		this.sessionDisposers.push(() => this.rendererProjectSynchronizer.dispose());

		this.sessionDisposers.push(watch(this.activeSceneId, async (sceneId, _previous, onCleanup) => {
			let cancelled = false;
			// 次のScene選択と購読終了のどちらでも、待機中の処理を同じ経路で失効させる。
			onCleanup(() => { cancelled = true; });
			// Scene追加コマンドの通知は同期watchの後に届く。差分を確定してから参照を切り替える。
			await this.rendererProjectSynchronizer.flush();
			if (cancelled) return;
			await this.updateTimelinePreviewOptions({ sceneId });
			if (cancelled) return;
			if (this.pendingSceneSeek != null) {
				const time = this.pendingSceneSeek;
				this.pendingSceneSeek = null;
				this.previewPlayback.seekTimeline(time, false);
			} else this.previewPlayback.refresh();
		}));

		this.projectSaveController = new ProjectSaveController(
			() => this.projectContext.snapshot(),
			{ fileName: options.fileName, fileHandle: options.fileHandle,
				sessionId: this.id, fileOperations: options.fileOperations, checkSaveDestination: options.checkSaveDestination },
			(component, props, events) => ui.popup(component, props, events, this),
		);
	}

	private getPreviewStaticOptions() {
		const state = this.projectContext.stateManager.state;
		const common = {
			previewDisplayMode: preferences.r.previewDisplayMode.value,
			enableStats: preferences.r.renderingStatsEnabled.value,
			enableWaveformAndHistogram: preferences.r.analysisMonitorsEnabled.value,
			enable32bitDataTextures: preferences.r.enable32bitDataTextures.value,
			effectRenderTiling: preferences.r.effectRenderTiling.value,
		};
		return {
			visualModule: common,
			timeline: { ...common, timelineFps: state.timelineFps.value,
				// 保存する書き出しサンプル数とプレビュー品質は別の設定として扱う。
				timelineMotionBlur: { ...state.timelineMotionBlur.value, samples: this.timelinePreviewMotionBlurSamples.value },
				previewFramesAhead: preferences.r.timelinePreviewFramesAhead.value,
				frameCacheMaxBytes: Math.floor(preferences.r.timelineFrameCacheMaxGiB.value * 1024 ** 3),
				frameCachePrecision: preferences.r.timelineFrameCachePrecision.value },
		};
	}

	public async toggleHighResolutionImageAnalysis() {
		try {
			if (this.highResolutionImageAnalysis.active.value) await this.highResolutionImageAnalysis.disable();
			else await this.highResolutionImageAnalysis.enable(this.activePreviewRenderer.value, this.imageAnalysisSettings.value);
		} catch (error) { this.renderEngine.fail(error); }
	}

	public setWaveformCanvasSize(direction: keyof PreviewWaveformCanvasSizes, size: PreviewWaveformCanvasSizes['horizontal']) {
		const previous = this.analysisWaveformCanvasSizes.value;
		if (previous?.[direction].width === size.width && previous[direction].height === size.height) return;
		this.analysisWaveformCanvasSizes.value = { horizontal: { width: 1, height: 1 }, vertical: { width: 1, height: 1 }, ...previous, [direction]: { ...size } };
		if (!this.highResolutionImageAnalysis.active.value) this.imageAnalysisDisplayUpdate.flush();
	}

	public setWaveformViewport(direction: keyof PreviewWaveformViewports, viewport: PreviewImageAnalysisViewport) {
		const previous = this.analysisWaveformViewports.value;
		const current = previous?.[direction] ?? FULL_PREVIEW_IMAGE_ANALYSIS_VIEWPORT;
		if (current.x === viewport.x && current.y === viewport.y && current.width === viewport.width && current.height === viewport.height) return;
		this.analysisWaveformViewports.value = { horizontal: { ...FULL_PREVIEW_IMAGE_ANALYSIS_VIEWPORT }, vertical: { ...FULL_PREVIEW_IMAGE_ANALYSIS_VIEWPORT }, ...previous, [direction]: { ...viewport } };
	}

	public setHistogramViewport(viewport: ImageValueRange) {
		const current = this.analysisHistogramViewport.value;
		if ((current?.minimum ?? 0) === viewport.minimum && (current?.maximum ?? 1) === viewport.maximum) return;
		this.analysisHistogramViewport.value = { ...viewport };
	}

	public flushImageAnalysisDisplay() {
		if (this.highResolutionImageAnalysis.active.value) this.highResolutionImageAnalysis.flush();
		else this.imageAnalysisDisplayUpdate.flush();
	}

	private refreshHeldDisplayAnalysis() {
		if (this.highResolutionImageAnalysis.active.value && this.imageAnalysisSettings.value.imageSource === 'previewAdjusted') {
			this.highResolutionImageAnalysis.update(this.imageAnalysisSettings.value);
		}
	}

	private updatePreviewOptions(options: Partial<Pick<TimelineRendererManagerDynamicOptions, 'resolution' | 'resolutionScale' | 'highlightClipping' | 'previewWarningImageSource' | 'previewGamutWarning' | 'previewExposure' | 'previewSrgbProof' | 'previewGamutCompression' | 'previewBackground' | 'analysisValueScale' | 'analysisTarget' | 'analysisImageSource' | 'analysisValueRange' | 'analysisPaused' | 'analysisWaveformCanvasSizes' | 'analysisWaveformViewports' | 'analysisHistogramViewport'>>) {
		this.renderEngine.notifyContentChange();
		return this.renderEngine.runRendererUpdate(() => Promise.all([
			this.visualModuleRendererManagerController.updateDynamicOptions(options),
			this.timelineRendererManagerController.updateDynamicOptions(options),
		]));
	}

	private updatePreviewDisplayActivity() {
		const mode = this.previewPlayback.state.value.mode;
		// 表示の切替は作品の変更ではない。非表示側の画像・キャッシュを残したまま、
		// 最終表示のアイドル更新だけを止め、両Workerの再生成も要求しない。
		return this.renderEngine.runRendererUpdate(() => {
			if (mode === this.synchronizedPreviewDisplayMode) return Promise.resolve();
			this.synchronizedPreviewDisplayMode = mode;
			// 初期値は生成時に渡す。同じ表示先への復帰では追加RPCを送らず、
			// 初期化中に切り替わった場合にもonReadyから最新の表示先へ同期する。
			return Promise.all([
				this.visualModuleRendererManagerController.updateDynamicOptions({ previewActive: mode === 'visualModuleLivePreview' }),
				this.timelineRendererManagerController.updateDynamicOptions({ previewActive: mode === 'timeline' }),
			]);
		});
	}

	private updateTimelinePreviewOptions(options: Partial<Omit<TimelineRendererManagerDynamicOptions, 'automationGraphs' | 'visualModules' | 'timelineScenes'>>) {
		this.renderEngine.notifyContentChange();
		return this.renderEngine.runRendererUpdate(() => this.timelineRendererManagerController.updateDynamicOptions(options));
	}

	private updateVisualModulePreviewOptions(options: Partial<VisualModuleRendererManagerDynamicOptions>) {
		this.renderEngine.notifyContentChange();
		return this.renderEngine.runRendererUpdate(() => this.visualModuleRendererManagerController.updateDynamicOptions(options));
	}

	/** 再生要求を止めてからGPUリソースを解放し、復帰完了後にだけ再生を戻す。 */
	public async suspendPreview(reason = 'operation') {
		if (this.disposed) return;
		this.renderEngine.suspend(reason);
		// 映像Workerを破棄しても、音声モニターとUIのCanvasは別の寿命で残る。
		// 両方の休止を反映してから、同じGPUを使う書き出しへ進む。
		await Promise.all([this.audioOutput.preview.setRenderingSuspended(true), nextTick()]);
	}

	public async resumePreview(reason = 'operation') {
		if (this.disposed) return;
		try {
			await this.renderEngine.resume(reason);
		} finally {
			// 再初期化の完了待ち中に別の休止が入った場合、その新しい要求を解除しない。
			if (!this.disposed) await this.audioOutput.preview.setRenderingSuspended(this.renderEngine.isSuspended.value);
		}
	}

	public async setActive(active: boolean): Promise<void> {
		if (this.disposed) return;
		if (active) await this.resumePreview('inactive');
		else await this.suspendPreview('inactive');
	}

	public async pauseForDesktopUpdate(): Promise<() => Promise<void>> {
		const resumeSaving = await this.projectSaveController.pauseForUpdate();
		try { await this.suspendPreview('desktopUpdate'); } catch (error) { resumeSaving(); throw error; }
		return async () => {
			try { await this.resumePreview('desktopUpdate'); } finally { resumeSaving(); }
		};
	}

	/** デスクトップ側への登録とプレビューの起動を一度だけ行う。再試行には新しいセッションを作る。 */
	public async start(): Promise<void> {
		if (this.disposed) return;
		// 最初のawaitより前に記録し、起動途中の重複呼び出しも拒否する。
		if (this.startupStarted) throw new Error('The project session has already started.');
		this.startupStarted = true;
		// マネージャーが非選択化してから起動する。新しいエンジンもenableまで無効なので、
		// 初期化用の休止を重ねず、選択時のsetActive(true)で初めて描画を開始する。

		const fileHandle = this.projectFileHandle.value;
		// セッションは新規生成するため、保存先のない作品には解除すべき旧登録がない。
		if (fileHandle?.kind === 'desktop-project-file') {
			await window.desktop?.setSessionProjectFile?.(this.id, fileHandle.id);
			if (this.disposed) return;
		}

		// 外部への音声生成は、購読の準備とは分けて保存先の登録後に開始する。
		this.sessionDisposers.push(watch(() => JSON.stringify(getVoicevoxRequests(this.projectContext.stateManager.state.timelineScenes.value)), () => {
			if (window.desktop) this.voicevoxGeneration.schedule();
			else this.voicevoxGeneration.synchronizeSpeech();
		}, { immediate: true, flush: 'sync' }));

		const state = this.projectContext.stateManager.state;
		if (state.visualModules.value[0] != null) this.previewPlayback.startVisualModuleLivePreview(state.visualModules.value[0].id);

		await this.renderEngine.enable();
	}

	public async flushRendererProjectChanges(): Promise<void> {
		try {
			await this.rendererProjectSynchronizer.flush();
		} catch (error) {
			if (this.renderEngine.canRender.value) this.renderEngine.fail(error);
		}
	}

	public saveProject(saveAs = false): Promise<void> {
		return this.projectSaveController.saveProject(saveAs);
	}

	/**
	 * 受付と購読は同期的に止め、既に始まったファイル書き込みの後処理だけを待つ。
	 * 非表示・書き出し中の休止とは異なり、このセッションは再開しない。
	 */
	public dispose(): Promise<void> {
		if (this.disposal != null) return this.disposal;
		this.disposed = true;
		for (const stop of this.sessionDisposers.splice(0)) stop();
		window.removeEventListener?.('focus', this.onWindowFocus);
		this.renderEngine.dispose();
		this.previewParameterEditing.clear();
		this.previewPlayback.dispose();
		this.voicevoxGeneration.dispose();
		this.disposal = Promise.all([this.audioOutput.dispose(), this.projectSaveController.dispose()]).then(async () => {
			await window.desktop?.closeProjectSession?.(this.id);
		});
		ui.disposeProjectSessionPopups(this);
		this.projectContext.dispose();
		this.scenePlaybackTimes.clear();
		return this.disposal;
	}
}
