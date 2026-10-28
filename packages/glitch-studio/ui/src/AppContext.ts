import { findTimelineLayer, flattenTimelineLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { getVoicevoxRequests } from '@gs/subsystems_timeline_shared/voicevox-requests.ts';
import { getVoicevoxRequestKey, createSpeechResolver } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import { openAudioFile } from '@gs/subsystems_audio_renderer/audio-file.ts';
import { genId } from '@gs/shared/utility/id.ts';

import { getTimelineScenesWithProjectAutomationGraphs } from '@gs/glitch-studio_shared/project/automation-graphs.ts';
import { computed, ref, shallowRef, markRaw, nextTick, watch } from 'vue';
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
import { ProjectSaveController } from './ProjectSaveController.ts';
import { applicationActivity } from './application-activity.ts';
import { getRendererAssets } from './utility/renderer-assets.ts';
import { resolveExternalAssets } from './external-assets.ts';
import { timelineClipboard, getTimelineEditorState, getSelectedTimelineLayerId } from './utility/timeline-editor-state.ts';
import type { GeneratedSpeech } from '@gs/glitch-studio_shared/voicevox.ts';
import type { VoicevoxSpeaker } from '@gs/glitch-studio_shared/voicevox.ts';
import type { Project, ProjectFileHandle } from './gsproj.ts';
import type { WatchStopHandle } from 'vue';
import type { IntermediateTextureFormat } from '@gs/shared/types.js';
import type { ProjectContext } from './Project.ts';
import type { RendererProjectState } from '@gs/glitch-studio_shared/project/renderer-state.js';
import type { TimelineRendererManagerDynamicOptions } from '@gs/glitch-studio_renderer/timeline-renderer-manager.ts';
import { i18n } from '@/i18n.ts';
import * as ui from '@/ui.ts';

const DEFAULT_TIMELINE_PREVIEW_MOTION_BLUR_SAMPLES = 0;

function getRendererIntermediateTextureFormat(): IntermediateTextureFormat {
	if (preferences.s.intermediateTextureFormat != null) return preferences.s.intermediateTextureFormat;
	const preferred = navigator.gpu.getPreferredCanvasFormat();
	return preferred === 'bgra8unorm' ? 'bgra8unorm' : 'rgba8unorm';
}

export const TIMELINE_PREVIEW_MOTION_BLUR_SAMPLE_OPTIONS = [0, 2, 4, 8] as const;

export class AppContext {
	public readonly projectContext: ProjectContext;
	public activeSceneId = ref<string | null>(null);
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
	public resolutionFactor = ref(1);
	public highlightClipping = ref(false);
	public audioOutput = markRaw(new AudioOutput());
	public visualModuleRendererManagerController: VisualModuleRendererManagerController;
	public timelineRendererManagerController: TimelineRendererManagerController;
	public timelineAudioPreview: TimelineAudioPreview;
	public previewPlayback: PreviewPlaybackController;
	public readonly voicevoxGeneration: VoicevoxGeneration;
	public readonly voicevoxConnection = { endpoint: ref('http://127.0.0.1:50021'), version: ref(''), speakers: ref<VoicevoxSpeaker[]>([]) };
	private readonly previewSpeech = shallowRef<GeneratedSpeech[]>([]);
	private pendingSceneSeek: number | null = null;
	private scenePlaybackTimes = new Map<string, number>();
	public readonly renderValidation: ProjectRenderValidation;
	public readonly renderEngine: PreviewRenderEngine;
	private projectWatchers: WatchStopHandle[] = [];
	private rendererProjectSynchronizer: RendererProjectSynchronizer | null = null;
	private projectSaveController: ProjectSaveController;
	public activePreviewRenderer = computed(() => this.previewPlayback.state.value.mode === 'visualModuleLivePreview' ? this.visualModuleRendererManagerController : this.timelineRendererManagerController);
	public get projectFileName() { return this.projectSaveController.projectFileName; }
	public get hasUnsavedChanges() { return this.projectSaveController.hasUnsavedChanges; }
	public get isProjectSaving() { return this.projectSaveController.isProjectSaving; }
	public get projectBackupAccess() { return this.projectSaveController.projectBackupAccess; }
	public get projectBackupStatus() { return this.projectSaveController.projectBackupStatus; }
	public get projectBackupController() { return this.projectSaveController.projectBackupController; }

	constructor(projectContext: ProjectContext) {
		this.projectContext = projectContext;
		this.renderValidation = markRaw(new ProjectRenderValidation(projectContext.stateManager.state, effectDefinitions));

		// Sceneを削除・Undoした場合にも、UIが存在しないSceneを編集し続けないようにする。
		watch(() => this.projectContext.stateManager.state.timelineScenes.value.map(scene => scene.id), ids => {
			if (this.activeSceneId.value == null || !ids.includes(this.activeSceneId.value)) this.activeSceneId.value = ids[0] ?? null;
		}, { flush: 'sync' });

		this.visualModuleRendererManagerController = markRaw(new VisualModuleRendererManagerController({
			enable32bitDataTextures: preferences.s.enable32bitDataTextures,
			intermediateTextureFormat: getRendererIntermediateTextureFormat(),
			enableStats: preferences.s.renderingStatsEnabled,
			enableWaveformAndHistogram: preferences.s.waveformAndHistogramEnabled,
		}, {
			fpsLimit: this.visualModuleLivePreviewFpsLimit.value,
			visualModuleLivePreviewTimeFactor: this.visualModuleLivePreviewTimeFactor.value,
			highlightClipping: this.highlightClipping.value,
		}, this.audioOutput));

		this.timelineRendererManagerController = markRaw(new TimelineRendererManagerController({
			enableStats: preferences.s.renderingStatsEnabled,
			enableWaveformAndHistogram: preferences.s.waveformAndHistogramEnabled,
			timelineFps: this.projectContext.stateManager.state.timelineFps.value,
			// プレビュー品質はUIだけが所有し、保存するプロジェクトのサンプル数は変更しない。
			timelineMotionBlur: { ...this.projectContext.stateManager.state.timelineMotionBlur.value, samples: this.timelinePreviewMotionBlurSamples.value },
			enable32bitDataTextures: preferences.s.enable32bitDataTextures,
			intermediateTextureFormat: getRendererIntermediateTextureFormat(),
		}, { highlightClipping: this.highlightClipping.value,
			previewFps: this.projectContext.stateManager.state.timelineFps.value * this.timelinePreviewFpsFactor.value,
			frameCacheMaxBytes: Math.floor(preferences.s.timelineFrameCacheMaxGiB * 1024 ** 3),
		}));

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
				this.renderEngine.requestRetry();
			},
		));
		this.renderEngine = markRaw(new PreviewRenderEngine({
			dispose: reason => {
				this.previewPlayback.suspend();
				this.visualModuleRendererManagerController.disposeManager(reason);
				this.timelineRendererManagerController.disposeManager(reason);
			},
			create: async isCurrent => {
				if (!isCurrent()) return;
				if (this.visualModuleRendererManagerController.isReady.value && this.timelineRendererManagerController.isReady.value) return;
				// エラー中の差分は送らない。再生成時に、UIの最新状態を一度だけ取り込む。
				const state = this.projectContext.stateManager.state;
				await this.replacePreviewProject({ automationGraphs: state.automationGraphs.value, visualModules: state.visualModules.value, timelineScenes: state.timelineScenes.value });
				await this.updatePreviewOptions({ assets: deepClone(state.assets.value), resolution: { ...state.resolution.value }, resolutionScale: this.resolutionFactor.value });
				await this.timelineRendererManagerController.updateDynamicOptions({ sceneId: this.activeSceneId.value, generatedSpeech: deepClone(this.previewSpeech.value) });
				if (!isCurrent()) return;
				const results = await Promise.allSettled([
					this.visualModuleRendererManagerController.relaunchManager(),
					this.timelineRendererManagerController.relaunchManager(),
				]);
				const failure = results.find(result => result.status === 'rejected');
				if (failure?.status === 'rejected') throw failure.reason;
				if (isCurrent()) this.previewPlayback.resume();
			},
		}));
		for (const controller of [this.visualModuleRendererManagerController, this.timelineRendererManagerController]) {
			controller.onRenderFailure = (error, origin) => {
				this.renderEngine.fail(error, origin);
				void resolveExternalAssets(this.projectContext.stateManager.state.assets.value);
			};
		}
		window.addEventListener?.('focus', () => {
			void resolveExternalAssets(this.projectContext.stateManager.state.assets.value);
		});
		this.visualModuleRendererManagerController.onAssetReadFailure = () => {
			void resolveExternalAssets(this.projectContext.stateManager.state.assets.value);
		};
		watch(this.previewPlayback.visualModuleLivePreviewVisualModuleId, id => {
			if (id != null) return;
			this.renderValidation.setVisualModuleLivePreviewInputs(null);
			this.renderEngine.setValidationError(this.renderValidation.errorMessage.value);
		}, { flush: 'sync' });
		watch(() => this.timelineAudioPreview.error.value, message => {
			if (message != null) {
				this.renderEngine.fail(new Error(message));
				void resolveExternalAssets(this.projectContext.stateManager.state.assets.value);
			}
		});
		projectContext.stateManager.onChange(changes => {
			this.renderValidation.update(changes);
			this.renderEngine.setValidationError(this.renderValidation.errorMessage.value);
			if (changes.some(change => !['nodeName', 'visualModuleName', 'layerName', 'layerColor', 'sceneName'].includes(change.type))) {
				this.renderEngine.requestRetry();
			}
		});

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
		watch([this.previewPlayback.isTimelinePlaying, this.projectContext.stateManager.state.generatedSpeech], ([playing], previous) => {
			if (!playing || !previous?.[0]) {
				const speech = this.projectContext.stateManager.state.generatedSpeech.value;
				// 配列だけのコピーでは各音声・AudioQueryにVueのProxyが残り、音声Workerの
				// postMessageが失敗する。ここで入れ子まで通常の値にし、再生中の一覧を固定する。
				if (speech.length !== this.previewSpeech.value.length || speech.some((item, index) => item.sourceId !== this.previewSpeech.value[index]?.sourceId)) this.previewSpeech.value = deepClone(speech);
			}
		}, { flush: 'sync' });
		watch(this.previewSpeech, speech => {
			void this.timelineRendererManagerController.updateDynamicOptions({ generatedSpeech: deepClone(speech) }).then(() => this.previewPlayback.refresh()).catch(error => {
				ui.alert({ type: 'error', text: String(error) });
				console.error(error);
			});
		}, { flush: 'sync' });

		watch(this.activeSceneId, (sceneId, previousId) => {
			// 音声更新のwatchより前に旧Sceneの時計を止め、切替先の長さで位置を丸めない。
			this.previewPlayback.pauseTimeline();
			if (previousId != null) this.scenePlaybackTimes.set(previousId, this.previewPlayback.currentTimelineTime.value);
			this.pendingSceneSeek = sceneId == null ? 0 : this.scenePlaybackTimes.get(sceneId) ?? 0;
		}, { flush: 'sync' });

		// Worker再読み込み後も、停止中のタイムラインの現在位置を復元する。
		watch(this.timelineRendererManagerController.isReady, ready => {
			if (ready) this.previewPlayback.refresh();
		});

		watch(this.highlightClipping, async value => {
			await this.updatePreviewOptions({ highlightClipping: value });
			this.renderEngine.requestRetry();
			this.previewPlayback.refresh();
		});

		watch(this.visualModuleLivePreviewFpsLimit, async value => {
			await this.visualModuleRendererManagerController.updateDynamicOptions({ fpsLimit: value });
			this.renderEngine.requestRetry();
		});

		watch(this.visualModuleLivePreviewTimeFactor, async value => {
			await this.visualModuleRendererManagerController.updateDynamicOptions({ visualModuleLivePreviewTimeFactor: value });
			this.renderEngine.requestRetry();
		});
		watch(this.timelinePreviewFpsFactor, async () => {
			await this.timelineRendererManagerController.updateDynamicOptions({ previewFps: this.projectContext.stateManager.state.timelineFps.value * this.timelinePreviewFpsFactor.value });
			this.previewPlayback.updateTimelinePreviewFps();
			this.renderEngine.requestRetry();
		});
		watch(preferences.r.timelineFrameCacheMaxGiB, async value => {
			await this.timelineRendererManagerController.updateDynamicOptions({ frameCacheMaxBytes: Math.floor(value * 1024 ** 3) });
			this.renderEngine.requestRetry();
			this.previewPlayback.refresh();
		});

		watch([this.projectContext.stateManager.state.resolution, this.resolutionFactor], async () => {
			await this.updatePreviewOptions({
				resolution: { ...this.projectContext.stateManager.state.resolution.value },
				resolutionScale: this.resolutionFactor.value,
			});
			this.renderEngine.requestRetry();
			this.previewPlayback.refresh();
		});

		watch([preferences.r.enable32bitDataTextures, preferences.r.intermediateTextureFormat, preferences.r.renderingStatsEnabled, preferences.r.waveformAndHistogramEnabled], async () => {
			const options = {
				enableStats: preferences.s.renderingStatsEnabled,
				enableWaveformAndHistogram: preferences.s.waveformAndHistogramEnabled,
				enable32bitDataTextures: preferences.s.enable32bitDataTextures,
				intermediateTextureFormat: getRendererIntermediateTextureFormat(),
			};
			await Promise.all([
				this.visualModuleRendererManagerController.updateStaticOptions(options),
				this.timelineRendererManagerController.updateStaticOptions(options),
			]);
			this.renderEngine.requestRetry();
		});

		this.projectSaveController = new ProjectSaveController(
			() => this.projectContext.snapshot(),
			id => { this.projectContext.adoptSavedProjectId(id); },
		);
	}

	private async updatePreviewOptions(options: Partial<Pick<TimelineRendererManagerDynamicOptions, 'assets' | 'resolution' | 'resolutionScale' | 'highlightClipping'>>) {
		if (options.assets != null) options = { ...options, assets: getRendererAssets(options.assets) };
		await Promise.all([
			this.visualModuleRendererManagerController.updateDynamicOptions(options),
			this.timelineRendererManagerController.updateDynamicOptions(options),
		]);
	}

	private async replacePreviewProject(state: RendererProjectState) {
		await Promise.all([
			this.visualModuleRendererManagerController.replaceProjectState(state),
			this.timelineRendererManagerController.replaceProjectState(state),
		]);
	}

	/** 再生要求を止めてからGPUリソースを解放し、復帰完了後にだけ再生を戻す。 */
	public async suspendPreview() {
		this.renderEngine.suspend();
		// 映像Workerを破棄しても、音声モニターとUIのCanvasは別の寿命で残る。
		// 両方の休止を反映してから、同じGPUを使う書き出しへ進む。
		await Promise.all([this.audioOutput.preview.setRenderingSuspended(true), nextTick()]);
	}

	public async resumePreview() {
		try {
			await this.renderEngine.resume();
		} finally {
			// 再初期化の完了待ち中に別の休止が入った場合、その新しい要求を解除しない。
			await this.audioOutput.preview.setRenderingSuspended(this.renderEngine.isSuspended.value);
		}
	}

	public async pauseForDesktopUpdate(): Promise<() => Promise<void>> {
		const resumeSaving = await this.projectSaveController.pauseForUpdate();
		try { await this.suspendPreview(); } catch (error) { resumeSaving(); throw error; }
		return async () => {
			try { if (this.projectContext.hasProject) await this.resumePreview(); } finally { resumeSaving(); }
		};
	}

	public async ready(project: Project, fileName: string | null = null, fileHandle: ProjectFileHandle | null = null) {
		return applicationActivity.run(() => this.loadProject(project, fileName, fileHandle));
	}

	private async loadProject(project: Project, fileName: string | null, fileHandle: ProjectFileHandle | null) {
		const waiting = ui.waiting({ text: i18n.ts._App.InitializingProject });

		await this.suspendPreview();
		timelineClipboard.value = null;
		this.scenePlaybackTimes.clear();
		// 画像からの新規作成とプロジェクト読込で同じ基準を使い、初回のGPU初期化にも反映する。
		const maxDimension = Math.max(project.resolution.width, project.resolution.height);
		const initialResolutionFactor = maxDimension > 3000 ? 0.25 : maxDimension > 1500 ? 0.5 : 1;
		const timelineRenderSettings = {
			timelineFps: project.timelineFps,
			timelineMotionBlur: { ...project.timelineMotionBlur, samples: DEFAULT_TIMELINE_PREVIEW_MOTION_BLUR_SAMPLES },
		};

		// 読み込み途中の状態を、直前のプロジェクトのファイルへ保存させない。
		this.projectSaveController.beginProjectLoad();
		for (const stop of this.projectWatchers) stop();
		this.projectWatchers = [];
		this.previewPlayback.dispose();
		// 同じIDのプロジェクトを再読込した場合も、以前の再生・ノード履歴を引き継がない。
		await this.replacePreviewProject({ automationGraphs: [], visualModules: [], timelineScenes: [] });
		await this.updatePreviewOptions({ assets: [] });
		await this.timelineRendererManagerController.updateDynamicOptions({ sceneId: null });
		await this.visualModuleRendererManagerController.updatePlayers([]);
		// 旧プロジェクトを解放してから設定を適用し、不要な素材の再アップロードを避ける。
		// 初回や同値の設定では再生成しない。通常編集のwatchは読込完了後に登録する。
		await this.timelineRendererManagerController.updateStaticOptions(timelineRenderSettings);

		this.timelinePreviewFpsFactor.value = 0.5;
		this.timelinePreviewMotionBlurSamples.value = DEFAULT_TIMELINE_PREVIEW_MOTION_BLUR_SAMPLES;
		this.resolutionFactor.value = initialResolutionFactor;

		this.voicevoxGeneration.reset();
		await resolveExternalAssets(project.assets);
		this.projectContext.load(project);
		this.renderValidation.reset();
		this.renderEngine.setValidationError(this.renderValidation.errorMessage.value);

		this.activeSceneId.value = project.timelineScenes[0]?.id ?? null;
		this.scenePlaybackTimes.clear();
		this.pendingSceneSeek = null;
		await this.replacePreviewProject({ automationGraphs: project.automationGraphs, visualModules: project.visualModules, timelineScenes: project.timelineScenes });
		await this.updatePreviewOptions({ assets: deepClone(project.assets) });
		await this.timelineRendererManagerController.updateDynamicOptions({ sceneId: this.activeSceneId.value,
			previewFps: project.timelineFps * this.timelinePreviewFpsFactor.value,
		});
		await this.visualModuleRendererManagerController.updatePlayers(deepClone(project.players));
		this.projectSaveController.finishProjectLoad(fileName, fileHandle);
		await window.desktop?.setCurrentProjectFile?.(fileHandle?.kind === 'desktop-project-file' ? fileHandle.id : null);

		// 発話編集・削除・Undo/Redoでは、旧音声と新字幕を混在させず再生を停止する。
		this.projectWatchers.push(watch(() => JSON.stringify(this.projectContext.stateManager.state.timelineScenes.value.map(scene => ({
			id: scene.id,
			layers: flattenTimelineLayers(scene.layers).filter(layer => layer.layerType === 'voicevox').map(layer => ({
				id: layer.id,
				voicevox: layer.voicevox,
				utterances: layer.utterances,
				clips: layer.clips,
				isDisabled: layer.isDisabled,
			})),
		}))), () => { if (this.previewPlayback.isTimelinePlaying.value) this.previewPlayback.pauseTimeline(); }, { flush: 'sync' }));
		this.projectWatchers.push(watch(() => JSON.stringify(getVoicevoxRequests(this.projectContext.stateManager.state.timelineScenes.value)), () => {
			if (window.desktop) this.voicevoxGeneration.schedule();
			else this.voicevoxGeneration.synchronizeSpeech();
		}, { immediate: true, flush: 'sync' }));

		// 1回のCommandで変わるfpsとブラー設定をまとめて送り、Undo/Redoも同じ再生成経路を通す。
		this.projectWatchers.push(watch([this.projectContext.stateManager.state.timelineFps, this.projectContext.stateManager.state.timelineMotionBlur, this.timelinePreviewMotionBlurSamples], async ([timelineFps], [previousTimelineFps]) => {
			try {
				await this.timelineRendererManagerController.updateStaticOptions({
					timelineFps: this.projectContext.stateManager.state.timelineFps.value,
					timelineMotionBlur: { ...this.projectContext.stateManager.state.timelineMotionBlur.value, samples: this.timelinePreviewMotionBlurSamples.value },
				});
				// ブラーだけの変更では、停止中の精密シーク位置とモードを維持する。
				if (timelineFps !== previousTimelineFps) {
					await this.timelineRendererManagerController.updateDynamicOptions({ previewFps: this.projectContext.stateManager.state.timelineFps.value * this.timelinePreviewFpsFactor.value });
					this.previewPlayback.updateTimelinePreviewFps();
				}
				this.renderEngine.requestRetry();
			} catch (error) {
				ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
				console.error(error);
			}
		}));

		// 音声の内容・参照素材・ループ長だけを比較する。Blobは不変なので同一性で判定し、
		// 素材名や映像パラメータの編集では再生中のWorkerと先読みPCMを維持する。
		this.projectWatchers.push(watch(() => {
			const layers = this.renderValidation.errorMessage.value || this.activeSceneId.value == null ? [] : getSceneAudioClips(this.timelineEvaluationScenes.value, this.activeSceneId.value, { type: 'all' }, createSpeechResolver(this.previewSpeech.value));
			const assetIds = new Set(layers.map(clip => clip.sourceId));
			return {
				layers: deepClone(layers),
				duration: this.activeScene.value == null ? 0 : getSceneDuration(this.activeScene.value),
				files: new Map(this.projectContext.stateManager.state.assets.value.filter(asset => assetIds.has(asset.id)).map(asset => [asset.id, asset.fileData])),
			};
		}, (next, previous) => {
			if (next.duration !== previous.duration || !deepEqual(next.layers, previous.layers)
					|| next.files.size !== previous.files.size || [...next.files].some(([id, file]) => previous.files.get(id) !== file)) {
				this.previewPlayback.refreshAudio();
			}
		}));

		this.projectWatchers.push(watch(this.projectContext.stateManager.state.assets, async () => {
			try {
				await resolveExternalAssets(this.projectContext.stateManager.state.assets.value);
				await this.updatePreviewOptions({ assets: deepClone(this.projectContext.stateManager.state.assets.value) });
				this.renderEngine.requestRetry();
				// 非同期の画像準備後にも、停止中のタイムラインを描き直す。
				this.previewPlayback.refresh();
			} catch (error) {
				ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
				console.error(error);
			}
		}, { deep: true }));

		this.projectWatchers.push(watch(this.projectContext.stateManager.state.players, () => {
			this.visualModuleRendererManagerController.updatePlayers(deepClone(this.projectContext.stateManager.state.players.value));
		}, { deep: true }));

		// UndoでVisual Module Live Preview対象が取り除かれたら、復旧や再初期化で存在しないVisual Moduleを再生しない。
		this.projectWatchers.push(this.projectContext.stateManager.onChange(changes => {
			this.previewPlayback.cancelTimelineBake();
			const visualModuleLivePreviewVisualModuleId = this.previewPlayback.visualModuleLivePreviewVisualModuleId.value;
			if (visualModuleLivePreviewVisualModuleId != null && changes.some(change => change.type === 'visualModuleRegistration' && change.visualModuleId === visualModuleLivePreviewVisualModuleId)
				&& this.projectContext.getVisualModuleById(visualModuleLivePreviewVisualModuleId) == null) this.previewPlayback.showTimeline();
		}));

		const rendererSync = new RendererProjectSynchronizer(this.projectContext.stateManager, {
			apply: async changes => {
				if (!this.renderEngine.canRender.value) return;
				await Promise.all([
					this.visualModuleRendererManagerController.applyProjectChanges(changes),
					this.timelineRendererManagerController.applyProjectChanges(changes),
				]);
			},
			onUpdated: () => this.previewPlayback.refresh(),
			onError: error => {
				if (this.renderEngine.canRender.value) this.renderEngine.fail(error);
			},
		});
		this.rendererProjectSynchronizer = rendererSync;
		this.projectWatchers.push(() => {
			rendererSync.dispose();
			this.rendererProjectSynchronizer = null;
		});

		let sceneUpdateGeneration = 0;
		this.projectWatchers.push(watch(this.activeSceneId, async (sceneId, _previous, onCleanup) => {
			const generation = ++sceneUpdateGeneration;
			let cancelled = false;
			onCleanup(() => { cancelled = true; });
			// Scene追加コマンドの通知は同期watchの後に届く。差分を確定してから参照を切り替える。
			await rendererSync.flush();
			if (cancelled || generation !== sceneUpdateGeneration) return;
			await this.timelineRendererManagerController.updateDynamicOptions({ sceneId });
			if (cancelled || generation !== sceneUpdateGeneration) return;
			if (this.pendingSceneSeek != null) {
				const time = this.pendingSceneSeek;
				this.pendingSceneSeek = null;
				this.previewPlayback.seekTimeline(time, false);
			} else this.previewPlayback.refresh();
		}));

		this.previewPlayback.seekTimeline(0, false);
		if (project.visualModules[0] != null) this.previewPlayback.startVisualModuleLivePreview(project.visualModules[0].id);

		waiting.setText(i18n.ts._App.InitializingRenderer);
		await this.renderEngine.enable();
		await this.resumePreview();

		waiting.done();
	}

	public async flushRendererProjectChanges(): Promise<void> {
		try {
			await this.rendererProjectSynchronizer?.flush();
		} catch (error) {
			if (this.renderEngine.canRender.value) this.renderEngine.fail(error);
		}
	}

	public grantProjectBackupAccess(): Promise<void> {
		return this.projectSaveController.grantProjectBackupAccess();
	}

	public saveProject(saveAs = false): Promise<void> {
		return this.projectSaveController.saveProject(saveAs);
	}
}
