
import { computed, ref, markRaw, watch } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.js';
import { getSceneDuration, validateTimelineScenes } from '@gs/subsystems_timeline_shared/scenes.js';
import { deepEqual } from '@gs/shared/utility/deep-equal.js';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.js';
import { validateTimelineEffectLayer } from '@gs/subsystems_timeline_shared/effect-layer.js';
import { validateTimelineFps, validateTimelineMotionBlur } from '@gs/subsystems_timeline_shared/motion-blur.js';
import { getSceneAudioClips } from '@gs/subsystems_timeline_shared/scene-audio.js';
import { AudioOutput } from './audio/audio-output.ts';
import { VisualModuleRendererManagerController } from './VisualModuleRendererManagerController.ts';
import { preferences } from './preferences.ts';
import { TimelineRendererManagerController } from './TimelineRendererManagerController.ts';
import { TimelineAudioPreview } from './audio/timeline-audio-preview.ts';
import { PreviewPlaybackController } from './PreviewPlaybackController.ts';
import { RendererProjectSynchronizer } from './RendererProjectSynchronizer.ts';
import { timelineLayerClipboard } from './utility/timeline-editor-state.ts';
import { projectSaveBackupWriter, ProjectSaveSession } from './project-save-session.ts';
import { createProjectBackupFingerprint, DEFAULT_PROJECT_BACKUP_SETTINGS, ProjectBackupController } from './project-backups.ts';
import { desktopProjectFile, encodeProjectFile, saveProjectFile } from './gsproj.ts';
import { browserProjectBackupDirectory, desktopProjectBackupDirectory, selectProjectBackupFolder } from './project-backup-directory.ts';
import GsProjectSaveDialog from './components/GsProjectSaveDialog.vue';
import GsProjectBackupFolderDialog from './components/GsProjectBackupFolderDialog.vue';
import type { Project, ProjectFileHandle } from './gsproj.ts';
import type { ProjectBackupStatus, ProjectBackupTarget } from './project-backups.ts';
import type { WatchStopHandle } from 'vue';
import type { IntermediateTextureFormat } from '@gs/shared/types.js';
import type { ProjectContext } from './Project.ts';
import type { RendererProjectState } from '@gs/glitch-studio_shared/project/renderer-state.js';
import type { TimelineRendererManagerDynamicOptions } from '@gs/glitch-studio_renderer/timeline-renderer-manager.ts';
import * as ui from '@/ui.ts';

const DEFAULT_TIMELINE_PREVIEW_MOTION_BLUR_SAMPLES = 0;

function getRendererIntermediateTextureFormat(): IntermediateTextureFormat {
	if (preferences.s.intermediateTextureFormat != null) return preferences.s.intermediateTextureFormat;
	const preferred = navigator.gpu.getPreferredCanvasFormat();
	return preferred === 'bgra8unorm' ? 'bgra8unorm' : 'rgba8unorm';
}

function resolveBackupTarget(handle: ProjectFileHandle, directory: FileSystemDirectoryHandle | null): ProjectBackupTarget | null {
	const native = handle.kind === 'desktop-project-file' ? desktopProjectBackupDirectory(handle.id) : null;
	return native ? { name: handle.name, directory: native } : directory ? { name: handle.name, directory: browserProjectBackupDirectory(directory) } : null;
}

async function selectProjectSaveFile(name: string): Promise<{ handle: ProjectFileHandle; directory: FileSystemDirectoryHandle | null } | null> {
	if (window.desktop?.chooseProjectSaveFile) {
		const descriptor = await window.desktop.chooseProjectSaveFile(name);
		return descriptor ? { handle: desktopProjectFile(descriptor), directory: null } : null;
	}
	return new Promise(resolve => {
		const { dispose } = ui.popup(GsProjectSaveDialog, { name }, {
			selected: (handle, directory) => resolve({ handle, directory: directory ?? null }),
			closed: () => { resolve(null); dispose(); },
		});
	});
}

function requestBackupDirectory(handle: FileSystemFileHandle): Promise<FileSystemDirectoryHandle | null> {
	return new Promise(resolve => {
		const { dispose } = ui.popup(GsProjectBackupFolderDialog, { handle }, {
			selected: directory => resolve(directory),
			closed: () => { resolve(null); dispose(); },
		});
	});
}

function backupSettings() { return preferences.s.projectBackups ?? DEFAULT_PROJECT_BACKUP_SETTINGS; }

const TIMELINE_PREVIEW_MOTION_BLUR_SAMPLE_OPTIONS = [0, 2, 4, 8] as const;

export class AppContext {
	public projectContext: ProjectContext;
	public activeSceneId = ref<string | null>(null);
	public activeScene = computed(() => this.projectContext.stateManager.state.timelineScenes.value.find(scene => scene.id === this.activeSceneId.value) ?? null);
	public liveFpsLimit = ref<number | null>(60);
	public timelinePreviewFpsFactor = ref(1);
	public timelinePreviewMotionBlurSamples = ref<(typeof TIMELINE_PREVIEW_MOTION_BLUR_SAMPLE_OPTIONS)[number]>(DEFAULT_TIMELINE_PREVIEW_MOTION_BLUR_SAMPLES);
	public liveTimeFactor = ref(1);
	public resolutionFactor = ref(1);
	public highlightClipping = ref(false);
	public audioOutput = markRaw(new AudioOutput());
	public visualModuleRendererManagerController: VisualModuleRendererManagerController;
	public timelineRendererManagerController: TimelineRendererManagerController;
	public timelineAudioPreview: TimelineAudioPreview;
	public previewPlayback: PreviewPlaybackController;
	private pendingSceneSeek: number | null = null;
	private scenePlaybackTimes = new Map<string, number>();
	private rendererInitialization: Promise<void> | null = null;
	private projectWatchers: WatchStopHandle[] = [];
	private projectMetadata: Pick<Project, 'id'> | null = null;
	private projectSaveSession: ProjectSaveSession;
	public activePreviewRenderer = computed(() => this.previewPlayback.state.value.mode === 'live' ? this.visualModuleRendererManagerController : this.timelineRendererManagerController);
	public projectBackupAccess = ref<'unsaved' | 'folder-required' | 'ready'>('unsaved');
	public projectBackupStatus = ref<ProjectBackupStatus>({ lastAutoBackup: null, lastSaveBackup: null, error: null });
	public projectBackupController: ProjectBackupController;
	private backupFingerprint = createProjectBackupFingerprint();

	constructor(projectContext: ProjectContext) {
		this.projectContext = projectContext;

		// Sceneを削除・Undoした場合にも、UIが存在しないSceneを編集し続けないようにする。
		watch(() => this.projectContext.stateManager.state.timelineScenes.value.map(scene => scene.id), ids => {
			if (this.activeSceneId.value == null || !ids.includes(this.activeSceneId.value)) this.activeSceneId.value = ids[0] ?? null;
		}, { flush: 'sync' });

		this.visualModuleRendererManagerController = markRaw(new VisualModuleRendererManagerController({
			enable32bitDataTextures: preferences.s.enable32bitDataTextures,
			intermediateTextureFormat: getRendererIntermediateTextureFormat(),
			enableStats: true,
		}, {
			fpsLimit: this.liveFpsLimit.value,
			liveTimeFactor: this.liveTimeFactor.value,
			highlightClipping: this.highlightClipping.value,
		}, this.audioOutput));

		this.timelineRendererManagerController = markRaw(new TimelineRendererManagerController({
			timelineFps: this.projectContext.stateManager.state.timelineFps.value,
			// プレビュー品質はUIだけが所有し、保存するプロジェクトのサンプル数は変更しない。
			timelineMotionBlur: { ...this.projectContext.stateManager.state.timelineMotionBlur.value, samples: this.timelinePreviewMotionBlurSamples.value },
			enable32bitDataTextures: preferences.s.enable32bitDataTextures,
			intermediateTextureFormat: getRendererIntermediateTextureFormat(),
		}, { highlightClipping: this.highlightClipping.value }));

		this.timelineAudioPreview = markRaw(new TimelineAudioPreview(
			() => this.audioOutput.getOutput(),
			() => ({ assets: deepClone(this.projectContext.stateManager.state.assets.value), timelineScenes: deepClone(this.projectContext.stateManager.state.timelineScenes.value), sceneId: this.activeSceneId.value }),
		));

		this.previewPlayback = markRaw(new PreviewPlaybackController(
			this.visualModuleRendererManagerController,
			this.timelineRendererManagerController,
			() => this.projectContext.stateManager.state.timelineFps.value * this.timelinePreviewFpsFactor.value,
			() => this.activeScene.value == null ? 0 : getSceneDuration(this.activeScene.value),
			this.timelineAudioPreview,
		));

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
			this.previewPlayback.refresh();
		});

		watch(this.liveFpsLimit, () => {
			this.visualModuleRendererManagerController.updateDynamicOptions({ fpsLimit: this.liveFpsLimit.value });
		});

		watch(this.liveTimeFactor, value => {
			this.visualModuleRendererManagerController.updateDynamicOptions({ liveTimeFactor: value });
		});

		watch([this.projectContext.stateManager.state.resolution, this.resolutionFactor], async () => {
			await this.updatePreviewOptions({
				resolution: { ...this.projectContext.stateManager.state.resolution.value },
				resolutionScale: this.resolutionFactor.value,
			});
			this.previewPlayback.refresh();
		});

		watch([preferences.r.enable32bitDataTextures, preferences.r.intermediateTextureFormat], async () => {
			const options = {
				enable32bitDataTextures: preferences.s.enable32bitDataTextures,
				intermediateTextureFormat: getRendererIntermediateTextureFormat(),
			};
			await Promise.all([
				this.visualModuleRendererManagerController.updateStaticOptions(options),
				this.timelineRendererManagerController.updateStaticOptions(options),
			]);
		});

		this.projectSaveSession = new ProjectSaveSession((target, previous) => {
			this.projectBackupAccess.value = target?.backup ? 'ready' : target ? 'folder-required' : 'unsaved';
			if (target?.backup !== previous?.backup) this.projectBackupController.setTarget(target?.backup ?? null);
		});

		this.projectBackupController = new ProjectBackupController({
			runExclusive: operation => this.projectSaveSession.runExclusive(operation),
			settings: backupSettings,
			snapshot: () => {
				const project = this.captureProject();
				return project ? { fingerprint: this.backupFingerprint(project), encode: () => encodeProjectFile(project) } : null;
			},
			onStatus: status => { this.projectBackupStatus.value = status; },
			now: () => Date.now(),
			schedule: (callback, delay) => window.setTimeout(callback, delay),
			cancel: timer => { if (timer != null) window.clearTimeout(timer as number); },
		});
		watch(() => preferences.r.projectBackups?.value, () => this.projectBackupController.refreshSchedule(), { deep: true });
	}

	private async updatePreviewOptions(options: Partial<Pick<TimelineRendererManagerDynamicOptions, 'assets' | 'resolution' | 'resolutionScale' | 'highlightClipping'>>) {
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
		this.previewPlayback.suspend();
		this.visualModuleRendererManagerController.disposeManager();
		this.timelineRendererManagerController.disposeManager();
	}

	public async resumePreview() {
	// 一方が失敗しても他方の初期化が終わるまで待ち、次の操作との競合を防ぐ。
		const results = await Promise.allSettled([
			this.visualModuleRendererManagerController.relaunchManager(),
			this.timelineRendererManagerController.relaunchManager(),
		]);
		const failure = results.find(result => result.status === 'rejected');
		if (failure?.status === 'rejected') throw failure.reason;
		this.previewPlayback.resume();
	}

	private captureProject(): Project | null {
		if (this.projectMetadata == null) return null;
		return deepClone({
			...this.projectMetadata,
			gsVersion: _VERSION_,
			name: this.projectContext.stateManager.state.name.value,
			description: this.projectContext.stateManager.state.description.value,
			author: this.projectContext.stateManager.state.author.value,
			visualModules: this.projectContext.stateManager.state.visualModules.value,
			assets: this.projectContext.stateManager.state.assets.value,
			players: this.projectContext.stateManager.state.players.value,
			timelineScenes: this.projectContext.stateManager.state.timelineScenes.value,
			resolution: this.projectContext.stateManager.state.resolution.value,
			timelineFps: this.projectContext.stateManager.state.timelineFps.value,
			timelineMotionBlur: this.projectContext.stateManager.state.timelineMotionBlur.value,
		} satisfies Project);
	}

	public async ready(project: Project, fileName = 'untitled.gsproj', fileHandle: ProjectFileHandle | null = null) {
		validateTimelineScenes(project.timelineScenes);
		validateTimelineFps(project.timelineFps);
		validateTimelineMotionBlur(project.timelineMotionBlur);
		for (const scene of project.timelineScenes) for (const layer of scene.layers) {
			if (layer.layerType === 'effect') validateTimelineEffectLayer(layer, effectDefinitions[layer.effectId]);
		}
		timelineLayerClipboard.layer = null;
		this.scenePlaybackTimes.clear();
		// 画像からの新規作成とプロジェクト読込で同じ基準を使い、初回のGPU初期化にも反映する。
		const maxDimension = Math.max(project.resolution.width, project.resolution.height);
		const initialResolutionFactor = maxDimension > 3000 ? 0.25 : maxDimension > 1500 ? 0.5 : 1;
		const timelineRenderSettings = {
			timelineFps: project.timelineFps,
			timelineMotionBlur: { ...project.timelineMotionBlur, samples: DEFAULT_TIMELINE_PREVIEW_MOTION_BLUR_SAMPLES },
		};
		if (this.rendererInitialization == null) {
			// 初回からプロジェクトの設定を使い、既定設定で起動してすぐ再生成するのを避ける。
			await this.timelineRendererManagerController.updateStaticOptions(timelineRenderSettings);
			this.rendererInitialization = Promise.all([
				this.visualModuleRendererManagerController,
				this.timelineRendererManagerController,
			].map(controller => controller.init(project.resolution, initialResolutionFactor))).then(() => {});
		}
		await this.rendererInitialization;

		// 読み込み途中の状態を、直前のプロジェクトのファイルへ保存させない。
		this.projectMetadata = null;
		this.projectSaveSession.setTarget(null);
		for (const stop of this.projectWatchers) stop();
		this.projectWatchers = [];
		this.previewPlayback.dispose();
		// 同じIDのプロジェクトを再読込した場合も、以前の再生・ノード履歴を引き継がない。
		await this.replacePreviewProject({ visualModules: [], timelineScenes: [] });
		await this.updatePreviewOptions({ assets: [] });
		await this.timelineRendererManagerController.updateDynamicOptions({ sceneId: null });
		await this.visualModuleRendererManagerController.updatePlayers([]);
		// 旧プロジェクトを解放してから設定を適用し、不要な素材の再アップロードを避ける。
		// 初回や同値の設定では再生成しない。通常編集のwatchは読込完了後に登録する。
		await this.timelineRendererManagerController.updateStaticOptions(timelineRenderSettings);

		this.timelinePreviewFpsFactor.value = 1;
		this.timelinePreviewMotionBlurSamples.value = DEFAULT_TIMELINE_PREVIEW_MOTION_BLUR_SAMPLES;
		this.resolutionFactor.value = initialResolutionFactor;

		this.projectContext.load(project);

		this.activeSceneId.value = project.timelineScenes[0]?.id ?? null;
		this.scenePlaybackTimes.clear();
		this.pendingSceneSeek = null;
		await this.replacePreviewProject({ visualModules: project.visualModules, timelineScenes: project.timelineScenes });
		await this.updatePreviewOptions({ assets: deepClone(project.assets) });
		await this.timelineRendererManagerController.updateDynamicOptions({ sceneId: this.activeSceneId.value });
		await this.visualModuleRendererManagerController.updatePlayers(deepClone(project.players));
		this.projectMetadata = { id: project.id };
		this.projectSaveSession.suggestedName = fileName;
		try {
			this.projectSaveSession.setTarget(fileHandle ? { handle: fileHandle, directory: null, backup: resolveBackupTarget(fileHandle, null) } : null);
		} catch (error) {
			this.projectSaveSession.setTarget(fileHandle ? { handle: fileHandle, directory: null, backup: null } : null);
			this.projectBackupController.reportError(error);
		}

		// 1回のCommandで変わるfpsとブラー設定をまとめて送り、Undo/Redoも同じ再生成経路を通す。
		this.projectWatchers.push(watch([this.projectContext.stateManager.state.timelineFps, this.projectContext.stateManager.state.timelineMotionBlur, this.timelinePreviewMotionBlurSamples], async () => {
			try {
				await this.timelineRendererManagerController.updateStaticOptions({
					timelineFps: this.projectContext.stateManager.state.timelineFps.value,
					timelineMotionBlur: { ...this.projectContext.stateManager.state.timelineMotionBlur.value, samples: this.timelinePreviewMotionBlurSamples.value },
				});
			} catch (error) {
				void ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
			}
		}));

		// 音声の内容・参照素材・ループ長だけを比較する。Blobは不変なので同一性で判定し、
		// 素材名や映像パラメータの編集では再生中のWorkerと先読みPCMを維持する。
		this.projectWatchers.push(watch(() => {
			const layers = this.activeSceneId.value == null ? [] : getSceneAudioClips(this.projectContext.stateManager.state.timelineScenes.value, this.activeSceneId.value);
			const assetIds = new Set(layers.map(clip => clip.assetId));
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
				await this.updatePreviewOptions({ assets: deepClone(this.projectContext.stateManager.state.assets.value) });
				// 非同期の画像準備後にも、停止中のタイムラインを描き直す。
				this.previewPlayback.refresh();
			} catch (error) {
				void ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
			}
		}, { deep: true }));

		this.projectWatchers.push(watch(this.projectContext.stateManager.state.players, () => {
			this.visualModuleRendererManagerController.updatePlayers(deepClone(this.projectContext.stateManager.state.players.value));
		}, { deep: true }));

		const rendererSync = new RendererProjectSynchronizer(this.projectContext.stateManager, {
			apply: async changes => {
				await Promise.all([
					this.visualModuleRendererManagerController.applyProjectChanges(changes),
					this.timelineRendererManagerController.applyProjectChanges(changes),
				]);
			},
			replace: this.replacePreviewProject,
			onUpdated: () => this.previewPlayback.refresh(),
			onError: error => { void ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) }); },
		});
		this.projectWatchers.push(() => rendererSync.dispose());

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
				this.previewPlayback.seekTimeline(time);
			} else this.previewPlayback.refresh();
		}));

		this.previewPlayback.seekTimeline(0);
		if (project.visualModules[0] != null) this.previewPlayback.startLive(project.visualModules[0].id);
	}

	public async grantProjectBackupAccess(): Promise<void> {
		const savedTarget = this.projectSaveSession.target;
		const handle = savedTarget?.handle;
		if (!handle) return;
		try {
			if (handle.kind === 'desktop-project-file') {
				const target = resolveBackupTarget(handle, null);
				if (this.projectSaveSession.target === savedTarget && target) this.projectSaveSession.setTarget({ handle, directory: null, backup: target });
				return;
			}
			// フォルダ選択はこのクリックから開始する。タイマーから権限ダイアログを要求しない。
			const directory = await selectProjectBackupFolder(handle);
			if (this.projectSaveSession.target !== savedTarget) return;
			this.projectSaveSession.setTarget({ handle, directory, backup: resolveBackupTarget(handle, directory) });
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'AbortError')) this.projectBackupController.reportError(error);
		}
	}

	public async saveProject(saveAs = false): Promise<void> {
		const project = this.captureProject();
		if (!project) return;
		const metadata = this.projectMetadata;
		const requestedHandle = saveAs ? null : this.projectSaveSession.target?.handle;
		// 待ち行列やエンコードより前に権限要求を始め、クリックの有効期間を失わない。
		// 待機中の拒否は値として受け、未処理のPromise rejectionにしない。
		const permission = requestedHandle?.requestPermission({ mode: 'readwrite' }).catch((error: unknown) => error);
		await this.projectSaveSession.runExclusive(async savedTarget => {
			try {
				if (metadata !== this.projectMetadata) return;
				let handle = saveAs ? null : savedTarget?.handle ?? null;
				let directory = saveAs ? null : savedTarget?.directory ?? null;
				let target = saveAs ? null : savedTarget?.backup ?? null;
				// 待機中にSave asが成功した場合、その保存先は選択時に許可済み。
				// 旧ハンドルの権限結果を流用せず確認し、ユーザー操作のないキュー内で新たな権限要求はしない。
				const granted = handle === requestedHandle ? await permission
					: handle?.kind === 'file' ? await handle.queryPermission({ mode: 'readwrite' }) : 'granted';
				if (handle && granted !== 'granted') throw new Error('Write permission was not granted. Use Save as... to choose another file.');
				const data = await encodeProjectFile(project);
				if (metadata !== this.projectMetadata) return;
				if (!handle) {
					const selected = await selectProjectSaveFile(this.projectSaveSession.suggestedName);
					if (!selected) return;
					({ handle, directory } = selected);
				}
				if (metadata !== this.projectMetadata) return;
				target ??= resolveBackupTarget(handle, directory);
				if (backupSettings().saveEnabled && (!target || !await target.directory.hasPermission())) {
					if (handle.kind === 'desktop-project-file') throw new Error('The project backup folder is unavailable.');
					directory = await requestBackupDirectory(handle);
					if (!directory) return;
					target = { name: handle.name, directory: browserProjectBackupDirectory(directory) };
				}
				if (metadata !== this.projectMetadata) return;
				let saveBackupTime: number | null = null;
				if (target && backupSettings().saveEnabled) {
					// 上書き前の実ファイルのバックアップが確定してから、本体を変更する。
					saveBackupTime = await this.projectBackupController.beforeSave(target, projectSaveBackupWriter(handle, target.directory));
				}
				if (metadata !== this.projectMetadata) return;
				await saveProjectFile(data, handle);
				if (metadata === this.projectMetadata) {
					this.projectSaveSession.setTarget({ handle, directory, backup: target });
					if (target) await this.projectBackupController.afterSave(target, saveBackupTime);
				}
			} catch (error) {
				await ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
			}
		});
	}
}
