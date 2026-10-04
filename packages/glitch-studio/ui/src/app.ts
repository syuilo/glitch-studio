import { validateTimelineFps, validateTimelineMotionBlur } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import { getSceneDuration, validateTimelineScenes } from '@gs/subsystems_timeline_shared/scenes.ts';
import { validateTimelineEffectLayer } from '@gs/subsystems_timeline_shared/effect-layer.ts';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import { getSceneAudioClips } from '@gs/subsystems_timeline_shared/scene-audio.ts';
import { createTimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import { visualModuleCustomParameterId, visualModuleCustomParameterName } from '@gs/subsystems_visual-module_shared/types.ts';
import { computed, ref, markRaw, watch } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { genId } from '@gs/shared/utility/id.ts';
import fillEffectDef from '@gs/subsystems_effect_shared/fx/fill/_def_.ts';
import imageEffectDef from '@gs/subsystems_effect_shared/fx/image/_def_.ts';
import videoEffectDef from '@gs/subsystems_effect_shared/fx/video/_def_.ts';
import audioWaveformEffectDef from '@gs/subsystems_effect_shared/fx/audioWaveform/_def_.ts';
import { DEFAULT_TIMELINE_FPS, DEFAULT_TIMELINE_MOTION_BLUR } from './project-defaults.ts';
import { timelineLayerClipboard } from './utility/timeline-editor-state.ts';
import { VisualModuleRendererManagerController } from './VisualModuleRendererManagerController.ts';
import { TimelineRendererManagerController } from './TimelineRendererManagerController.ts';
import { TimelineAudioPreview } from './audio/timeline-audio-preview.ts';
import { AudioOutput } from './audio/audio-output.ts';
import { PreviewPlaybackController } from './PreviewPlaybackController.ts';
import { AppStateManager } from './AppStateManager.ts';
import { RendererProjectSynchronizer } from './RendererProjectSynchronizer.ts';
import { DEFAULT_PROJECT_NAME, encodeProjectFile, loadProjectFile, saveProjectFile } from './gsproj.ts';
import GsProjectSaveDialog from './components/GsProjectSaveDialog.vue';
import { preferences } from './preferences.ts';
import { makeHotkey } from './utility/hotkey.ts';
import type { RendererProjectState } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import type { Keymap } from './utility/hotkey.ts';
import type { ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';
import type { TimelineRendererManagerDynamicOptions } from '@gs/glitch-studio_renderer/timeline-renderer-manager.ts';
import type { EffectNodeOf } from '@gs/subsystems_visual-module_shared/types.ts';
import type { Asset, IntermediateTextureFormat, Player } from '@gs/shared/types.ts';
import type { Project, ProjectInfo } from './gsproj.ts';
import type { WatchStopHandle } from 'vue';
import * as ui from '@/ui.ts';
import * as api from '@/api.ts';

export const appStateManager = new AppStateManager();
export const activeSceneId = ref<string | null>(null);
export const activeScene = computed(() => appStateManager.state.timelineScenes.value.find(scene => scene.id === activeSceneId.value) ?? null);
const scenePlaybackTimes = new Map<string, number>();
let pendingSceneSeek: number | null = null;
// Sceneを削除・Undoした場合にも、UIが存在しないSceneを編集し続けないようにする。
watch(() => appStateManager.state.timelineScenes.value.map(scene => scene.id), ids => {
	if (activeSceneId.value == null || !ids.includes(activeSceneId.value)) activeSceneId.value = ids[0] ?? null;
}, { flush: 'sync' });
// プロジェクト情報はUndo/Redoの管理対象に含めない。
export const projectInfo = ref<ProjectInfo>({ name: DEFAULT_PROJECT_NAME, description: '', author: '' });

watch(() => projectInfo.value.name, name => {
	window.document.title = name ? `Glitch Studio (${name})` : 'Glitch Studio';
}, { immediate: true });

(window as any).appStateManager = appStateManager; // debug

function benchmark(count = 100, visualModuleId = appStateManager.state.visualModules.value[0]?.id) {
	if (visualModuleId == null) return;
	for (let i = 0; i < count; i++) {
		appStateManager.commit('addEffectNode', {
			visualModuleId,
			effectId: 'blockShuffle',
			id: genId(),
			params: {
				seed: { inputSource: 'literal', value: Math.random() * 1000 },
			},
		});
	}
}

(window as any).benchmark = benchmark; // debug

export const liveFpsLimit = ref<number | null>(60);
export const timelinePreviewFpsFactor = ref(1);
export const TIMELINE_PREVIEW_MOTION_BLUR_SAMPLE_OPTIONS = [0, 2, 4, 8] as const;
const DEFAULT_TIMELINE_PREVIEW_MOTION_BLUR_SAMPLES = 0;
export const timelinePreviewMotionBlurSamples = ref<(typeof TIMELINE_PREVIEW_MOTION_BLUR_SAMPLE_OPTIONS)[number]>(DEFAULT_TIMELINE_PREVIEW_MOTION_BLUR_SAMPLES);
export const liveTimeFactor = ref(1);
export const resolutionFactor = ref(1);
export const highlightClipping = ref(false);

export const rendererEnv = {
	mouseX: 0,
	mouseY: 0,
};

function getRendererIntermediateTextureFormat(): IntermediateTextureFormat {
	if (preferences.s.intermediateTextureFormat != null) return preferences.s.intermediateTextureFormat;
	const preferred = navigator.gpu.getPreferredCanvasFormat();
	return preferred === 'bgra8unorm' ? 'bgra8unorm' : 'rgba8unorm';
}

export const audioOutput = markRaw(new AudioOutput());

export const visualModuleRendererManagerController = markRaw(new VisualModuleRendererManagerController({
	enable32bitDataTextures: preferences.s.enable32bitDataTextures,
	intermediateTextureFormat: getRendererIntermediateTextureFormat(),
	enableStats: true,
}, {
	fpsLimit: liveFpsLimit.value,
	liveTimeFactor: liveTimeFactor.value,
	highlightClipping: highlightClipping.value,
}, audioOutput));

export const timelineRendererManagerController = markRaw(new TimelineRendererManagerController({
	timelineFps: appStateManager.state.timelineFps.value,
	// プレビュー品質はUIだけが所有し、保存するプロジェクトのサンプル数は変更しない。
	timelineMotionBlur: { ...appStateManager.state.timelineMotionBlur.value, samples: timelinePreviewMotionBlurSamples.value },
	enable32bitDataTextures: preferences.s.enable32bitDataTextures,
	intermediateTextureFormat: getRendererIntermediateTextureFormat(),
}, { highlightClipping: highlightClipping.value }));

export const timelineAudioPreview = markRaw(new TimelineAudioPreview(
	() => audioOutput.getOutput(),
	() => ({ assets: deepClone(appStateManager.state.assets.value), timelineScenes: deepClone(appStateManager.state.timelineScenes.value), sceneId: activeSceneId.value }),
));
export const previewPlayback = markRaw(new PreviewPlaybackController(
	visualModuleRendererManagerController, timelineRendererManagerController, () => appStateManager.state.timelineFps.value * timelinePreviewFpsFactor.value,
	() => activeScene.value == null ? 0 : getSceneDuration(activeScene.value), timelineAudioPreview,
));
watch(activeSceneId, (sceneId, previousId) => {
	// 音声更新のwatchより前に旧Sceneの時計を止め、切替先の長さで位置を丸めない。
	previewPlayback.pauseTimeline();
	if (previousId != null) scenePlaybackTimes.set(previousId, previewPlayback.currentTimelineTime.value);
	pendingSceneSeek = sceneId == null ? 0 : scenePlaybackTimes.get(sceneId) ?? 0;
}, { flush: 'sync' });
export const activePreviewRenderer = computed(() => previewPlayback.state.value.mode === 'live'
	? visualModuleRendererManagerController : timelineRendererManagerController);

async function updatePreviewOptions(options: Partial<Pick<TimelineRendererManagerDynamicOptions, 'assets' | 'resolution' | 'resolutionScale' | 'highlightClipping'>>) {
	await Promise.all([
		visualModuleRendererManagerController.updateDynamicOptions(options),
		timelineRendererManagerController.updateDynamicOptions(options),
	]);
}

async function replacePreviewProject(state: RendererProjectState) {
	await Promise.all([
		visualModuleRendererManagerController.replaceProjectState(state),
		timelineRendererManagerController.replaceProjectState(state),
	]);
}

/** 再生要求を止めてからGPUリソースを解放し、復帰完了後にだけ再生を戻す。 */
export function suspendPreview() {
	previewPlayback.suspend();
	visualModuleRendererManagerController.disposeManager();
	timelineRendererManagerController.disposeManager();
}

export async function resumePreview() {
	// 一方が失敗しても他方の初期化が終わるまで待ち、次の操作との競合を防ぐ。
	const results = await Promise.allSettled([
		visualModuleRendererManagerController.relaunchManager(),
		timelineRendererManagerController.relaunchManager(),
	]);
	const failure = results.find(result => result.status === 'rejected');
	if (failure?.status === 'rejected') throw failure.reason;
	previewPlayback.resume();
}

// Worker再読み込み後も、停止中のタイムラインの現在位置を復元する。
watch(timelineRendererManagerController.isReady, ready => {
	if (ready) previewPlayback.refresh();
});

watch(highlightClipping, async value => {
	await updatePreviewOptions({ highlightClipping: value });
	previewPlayback.refresh();
});

(window as any).renderer = visualModuleRendererManagerController; // debug

watch(liveFpsLimit, () => {
	visualModuleRendererManagerController.updateDynamicOptions({ fpsLimit: liveFpsLimit.value });
});

watch(liveTimeFactor, value => {
	visualModuleRendererManagerController.updateDynamicOptions({ liveTimeFactor: value });
});

watch([appStateManager.state.resolution, resolutionFactor], async () => {
	await updatePreviewOptions({
		resolution: { ...appStateManager.state.resolution.value },
		resolutionScale: resolutionFactor.value,
	});
	previewPlayback.refresh();
});

watch([preferences.r.enable32bitDataTextures, preferences.r.intermediateTextureFormat], async () => {
	const options = {
		enable32bitDataTextures: preferences.s.enable32bitDataTextures,
		intermediateTextureFormat: getRendererIntermediateTextureFormat(),
	};
	await Promise.all([
		visualModuleRendererManagerController.updateStaticOptions(options),
		timelineRendererManagerController.updateStaticOptions(options),
	]);
});

let rendererInitialization: Promise<void> | null = null;
let projectWatchers: WatchStopHandle[] = [];
let projectMetadata: Pick<Project, 'id'> | null = null;
let projectFileName = 'untitled.gsproj';
let projectFileHandle: FileSystemFileHandle | null = null;
let savingProject = false;

export async function appReady(project: Project, fileName = 'untitled.gsproj', fileHandle: FileSystemFileHandle | null = null) {
	validateTimelineScenes(project.timelineScenes);
	validateTimelineFps(project.timelineFps);
	validateTimelineMotionBlur(project.timelineMotionBlur);
	for (const scene of project.timelineScenes) for (const layer of scene.layers) {
		if (layer.layerType === 'effect') validateTimelineEffectLayer(layer, effectDefinitions[layer.effectId]);
	}
	timelineLayerClipboard.layer = null;
	scenePlaybackTimes.clear();
	// 画像からの新規作成とプロジェクト読込で同じ基準を使い、初回のGPU初期化にも反映する。
	const maxDimension = Math.max(project.resolution.width, project.resolution.height);
	const initialResolutionFactor = maxDimension > 3000 ? 0.25 : maxDimension > 1500 ? 0.5 : 1;
	const timelineRenderSettings = {
		timelineFps: project.timelineFps,
		timelineMotionBlur: { ...project.timelineMotionBlur, samples: DEFAULT_TIMELINE_PREVIEW_MOTION_BLUR_SAMPLES },
	};
	if (rendererInitialization == null) {
		// 初回からプロジェクトの設定を使い、既定設定で起動してすぐ再生成するのを避ける。
		await timelineRendererManagerController.updateStaticOptions(timelineRenderSettings);
		rendererInitialization = Promise.all([visualModuleRendererManagerController, timelineRendererManagerController].map(controller => controller.init(project.resolution, initialResolutionFactor))).then(() => {});
	}
	await rendererInitialization;

	// 読み込み途中の状態を、直前のプロジェクトのファイルへ保存させない。
	projectMetadata = null;
	projectFileHandle = null;
	for (const stop of projectWatchers) stop();
	projectWatchers = [];
	previewPlayback.dispose();
	// 同じIDのプロジェクトを再読込した場合も、以前の再生・ノード履歴を引き継がない。
	await replacePreviewProject({ visualModules: [], timelineScenes: [] });
	await updatePreviewOptions({ assets: [] });
	await timelineRendererManagerController.updateDynamicOptions({ sceneId: null });
	await visualModuleRendererManagerController.updatePlayers([]);
	// 旧プロジェクトを解放してから設定を適用し、不要な素材の再アップロードを避ける。
	// 初回や同値の設定では再生成しない。通常編集のwatchは読込完了後に登録する。
	await timelineRendererManagerController.updateStaticOptions(timelineRenderSettings);

	appStateManager.state.resolution.value = project.resolution;
	appStateManager.state.timelineFps.value = project.timelineFps;
	appStateManager.state.timelineMotionBlur.value = deepClone(project.timelineMotionBlur);
	timelinePreviewFpsFactor.value = 1;
	timelinePreviewMotionBlurSamples.value = DEFAULT_TIMELINE_PREVIEW_MOTION_BLUR_SAMPLES;
	resolutionFactor.value = initialResolutionFactor;
	appStateManager.state.assets.value = project.assets;
	appStateManager.state.visualModules.value = project.visualModules;
	appStateManager.state.players.value = project.players;
	appStateManager.state.timelineScenes.value = project.timelineScenes;
	activeSceneId.value = project.timelineScenes[0]?.id ?? null;
	scenePlaybackTimes.clear();
	pendingSceneSeek = null;
	appStateManager.undoStack.value = [];
	appStateManager.redoStack.value = [];
	await replacePreviewProject({ visualModules: project.visualModules, timelineScenes: project.timelineScenes });
	await updatePreviewOptions({ assets: deepClone(project.assets) });
	await timelineRendererManagerController.updateDynamicOptions({ sceneId: activeSceneId.value });
	await visualModuleRendererManagerController.updatePlayers(deepClone(project.players));
	projectMetadata = { id: project.id };
	projectInfo.value = { name: project.name, description: project.description, author: project.author };
	projectFileName = fileName;
	projectFileHandle = fileHandle;

	// 1回のCommandで変わるfpsとブラー設定をまとめて送り、Undo/Redoも同じ再生成経路を通す。
	projectWatchers.push(watch([appStateManager.state.timelineFps, appStateManager.state.timelineMotionBlur, timelinePreviewMotionBlurSamples], async () => {
		try {
			await timelineRendererManagerController.updateStaticOptions({
				timelineFps: appStateManager.state.timelineFps.value,
				timelineMotionBlur: { ...appStateManager.state.timelineMotionBlur.value, samples: timelinePreviewMotionBlurSamples.value },
			});
		} catch (error) {
			void ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
		}
	}));

	// 音声の内容・参照素材・ループ長だけを比較する。Blobは不変なので同一性で判定し、
	// 素材名や映像パラメータの編集では再生中のWorkerと先読みPCMを維持する。
	projectWatchers.push(watch(() => {
		const layers = activeSceneId.value == null ? [] : getSceneAudioClips(appStateManager.state.timelineScenes.value, activeSceneId.value);
		const assetIds = new Set(layers.map(clip => clip.assetId));
		return {
			layers: deepClone(layers),
			duration: activeScene.value == null ? 0 : getSceneDuration(activeScene.value),
			files: new Map(appStateManager.state.assets.value.filter(asset => assetIds.has(asset.id)).map(asset => [asset.id, asset.fileData])),
		};
	}, (next, previous) => {
		if (next.duration !== previous.duration || !deepEqual(next.layers, previous.layers)
			|| next.files.size !== previous.files.size || [...next.files].some(([id, file]) => previous.files.get(id) !== file)) {
			previewPlayback.refreshAudio();
		}
	}));

	projectWatchers.push(watch(appStateManager.state.assets, async () => {
		try {
			await updatePreviewOptions({ assets: deepClone(appStateManager.state.assets.value) });
			// 非同期の画像準備後にも、停止中のタイムラインを描き直す。
			previewPlayback.refresh();
		} catch (error) {
			void ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
		}
	}, { deep: true }));

	projectWatchers.push(watch(appStateManager.state.players, () => {
		visualModuleRendererManagerController.updatePlayers(deepClone(appStateManager.state.players.value));
	}, { deep: true }));

	const rendererSync = new RendererProjectSynchronizer(appStateManager, {
		apply: async changes => {
			await Promise.all([
				visualModuleRendererManagerController.applyProjectChanges(changes),
				timelineRendererManagerController.applyProjectChanges(changes),
			]);
		},
		replace: replacePreviewProject,
		onUpdated: () => previewPlayback.refresh(),
		onError: error => { void ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) }); },
	});
	projectWatchers.push(() => rendererSync.dispose());

	let sceneUpdateGeneration = 0;
	projectWatchers.push(watch(activeSceneId, async (sceneId, _previous, onCleanup) => {
		const generation = ++sceneUpdateGeneration;
		let cancelled = false;
		onCleanup(() => { cancelled = true; });
		// Scene追加コマンドの通知は同期watchの後に届く。差分を確定してから参照を切り替える。
		await rendererSync.flush();
		if (cancelled || generation !== sceneUpdateGeneration) return;
		await timelineRendererManagerController.updateDynamicOptions({ sceneId });
		if (cancelled || generation !== sceneUpdateGeneration) return;
		if (pendingSceneSeek != null) {
			const time = pendingSceneSeek;
			pendingSceneSeek = null;
			previewPlayback.seekTimeline(time);
		} else previewPlayback.refresh();
	}));

	previewPlayback.seekTimeline(0);
	if (project.visualModules[0] != null) previewPlayback.startLive(project.visualModules[0].id);
}

function selectProjectSaveFile(name: string): Promise<FileSystemFileHandle | null> {
	return new Promise(resolve => {
		const { dispose } = ui.popup(GsProjectSaveDialog, { name }, {
			selected: handle => resolve(handle),
			closed: () => { resolve(null); dispose(); },
		});
	});
}

export async function saveProject(saveAs = false) {
	if (projectMetadata == null || savingProject) return;
	savingProject = true;
	const metadata = projectMetadata;
	try {
		// 素材の読み出し中に編集されても、保存開始時点の状態を一貫して書き出す。
		const project = deepClone({
			...projectMetadata,
			...projectInfo.value,
			gsVersion: _VERSION_,
			visualModules: appStateManager.state.visualModules.value,
			assets: appStateManager.state.assets.value,
			players: appStateManager.state.players.value,
			timelineScenes: appStateManager.state.timelineScenes.value,
			resolution: appStateManager.state.resolution.value,
			timelineFps: appStateManager.state.timelineFps.value,
			timelineMotionBlur: appStateManager.state.timelineMotionBlur.value,
		} satisfies Project);
		let handle = saveAs ? null : projectFileHandle;
		// 既存の保存先の権限要求にはクリックの有効期間が必要なので、エンコードより先に行う。
		if (handle != null && await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
			throw new Error('Write permission was not granted. Use Save as... to choose another file.');
		}
		const data = await encodeProjectFile(project);
		// 初回保存・Save asはデータの準備後に選択する。フォルダ選択のクリックが新たなユーザー操作になる。
		// 保存先の取得時に新規ファイルを作成する場合も、読込失敗ならここへ到達しない。
		handle ??= await selectProjectSaveFile(projectFileName);
		if (handle == null) return;
		await saveProjectFile(data, handle);
		// 保存中に別プロジェクトを開いた場合、そのプロジェクトの保存先は変更しない。
		if (projectMetadata === metadata) {
			projectFileHandle = handle;
			projectFileName = handle.name;
		}
	} catch (error) {
		await ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
	} finally {
		savingProject = false;
	}
}

export async function openProject(file?: File, fileHandle?: FileSystemFileHandle): Promise<boolean> {
	try {
		const result = await loadProjectFile(file, fileHandle);
		if (result == null) return false;
		await appReady(result.project, result.name, result.handle);
		return true;
	} catch (error) {
		await ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
		return false;
	}
}

export async function newProject() {
	const initialEffectNodeId = genId();
	const initialInputParamId = visualModuleCustomParameterId(genId());
	const initialOutputId = genId();
	const initialVisualModule: ProjectVisualModule = {
		id: genId(),
		name: 'My Visual Module',
		automationGraphs: [],
		outputDefs: [{ id: initialOutputId, label: 'Output', name: 'output', dataType: { kind: 'color' } }],
		primaryOutputId: initialOutputId,
		primaryInputId: initialInputParamId,
		paramDefs: [{
			id: initialInputParamId,
			nameForReference: visualModuleCustomParameterName('myInput'),
			dataType: { kind: 'color' },
			ui: { label: 'My Input', control: {} },
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
			canNode: true,
		}],
		nodes: [{
			id: genId(),
			type: 'globalIn',
		}, {
			id: initialEffectNodeId,
			type: 'effect',
			resolution: { mode: 'auto' },
			effectId: 'fill',
			params: {
				color: { inputSource: 'literal', value: [0, 1, 0, 1] },
			},
			isBypass: false,
		} satisfies EffectNodeOf<typeof fillEffectDef>, {
			id: genId(),
			type: 'globalOut',
			inputs: { [initialOutputId]: {
				nodeId: initialEffectNodeId,
				outputPort: 'output',
			} },
		}],
	} satisfies ProjectVisualModule;
	await appReady({
		id: genId(),
		gsVersion: _VERSION_,
		name: DEFAULT_PROJECT_NAME,
		description: '',
		author: '',
		visualModules: [initialVisualModule],
		assets: [],
		players: [],
		timelineScenes: [{ id: genId(), name: 'Main Scene', resolution: { mode: 'project' }, layers: [{
			id: genId(),
			layerType: 'visualModule',
			isDisabled: false,
			visualModuleId: initialVisualModule.id,
			visualModuleParamValues: {},
			compositingParamValues: deepClone({
				fitMode: timelineCompositingParamDefs.fitMode.defaultValue,
				blendMode: timelineCompositingParamDefs.blendMode.defaultValue,
				opacity: timelineCompositingParamDefs.opacity.defaultValue,
				position: timelineCompositingParamDefs.position.defaultValue,
				origin: timelineCompositingParamDefs.origin.defaultValue,
				scale: timelineCompositingParamDefs.scale.defaultValue,
				rotation: timelineCompositingParamDefs.rotation.defaultValue,
			}),
			automationGraphs: [],
			name: 'Visual Module', clips: [{ id: genId(), ...createTimelineClipTiming(0, 1000 * 10) }],
		}] }],
		timelineFps: DEFAULT_TIMELINE_FPS,
		timelineMotionBlur: { ...DEFAULT_TIMELINE_MOTION_BLUR },
		resolution: { width: 1024, height: 1024 },
	});
}

export async function newProjectFromImageOrVideo(file?: File) {
	const result = await api.openMediaFile({ file });
	if (result == null) return false;

	const asset = {
		id: genId(),
		name: result.name,
		width: result.width,
		height: result.height,
		fileDataType: result.type,
		fileData: result.fileData,
		hash: result.hash,
	} satisfies Asset;

	const player = result.type.startsWith('video/') || result.type.startsWith('audio/') ? {
		id: genId(),
		name: result.name,
		sourceType: 'asset',
		assetId: asset.id,
	} satisfies Player : null;

	const initialEffectNodeId = genId();
	const initialInputParamId = visualModuleCustomParameterId(genId());
	const initialOutputId = genId();
	const initialVisualModule: ProjectVisualModule = {
		id: genId(),
		name: 'My Visual Module',
		automationGraphs: [],
		outputDefs: [{ id: initialOutputId, label: 'Output', name: 'output', dataType: { kind: 'color' } }],
		primaryOutputId: initialOutputId,
		primaryInputId: initialInputParamId,
		paramDefs: [{
			id: initialInputParamId,
			nameForReference: visualModuleCustomParameterName('myInput'),
			dataType: { kind: 'color' },
			ui: { label: 'My Input', control: {} },
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
			canNode: true,
		}],
		nodes: [{
			id: genId(),
			type: 'globalIn',
		}, result.type.startsWith('image/') ? {
			id: initialEffectNodeId,
			type: 'effect',
			resolution: { mode: 'auto' },
			effectId: 'image',
			params: {
				image: { inputSource: 'literal', value: asset.id },
				fit: deepClone(imageEffectDef.paramDefs.fit.defaultValue),
			},
			isBypass: false,
		} satisfies EffectNodeOf<typeof imageEffectDef> : result.type.startsWith('video/') ? {
			id: initialEffectNodeId,
			type: 'effect',
			resolution: { mode: 'auto' },
			effectId: 'video',
			params: {
				player: { inputSource: 'literal', value: player!.id },
				fit: deepClone(videoEffectDef.paramDefs.fit.defaultValue),
			},
			isBypass: false,
		} satisfies EffectNodeOf<typeof videoEffectDef> : result.type.startsWith('audio/') ? {
			id: initialEffectNodeId,
			type: 'effect',
			resolution: { mode: 'auto' },
			effectId: 'audioWaveform',
			params: {
				player: { inputSource: 'literal', value: player!.id },
				channel: deepClone(audioWaveformEffectDef.paramDefs.channel.defaultValue),
				duration: deepClone(audioWaveformEffectDef.paramDefs.duration.defaultValue),
				amplitude: deepClone(audioWaveformEffectDef.paramDefs.amplitude.defaultValue),
				lineWidth: deepClone(audioWaveformEffectDef.paramDefs.lineWidth.defaultValue),
				colorL: deepClone(audioWaveformEffectDef.paramDefs.colorL.defaultValue),
				colorR: deepClone(audioWaveformEffectDef.paramDefs.colorR.defaultValue),
			},
			isBypass: false,
		} satisfies EffectNodeOf<typeof audioWaveformEffectDef> : {
			id: initialEffectNodeId,
			type: 'effect',
			resolution: { mode: 'auto' },
			effectId: 'fill',
			params: {
				color: { inputSource: 'literal', value: [0, 1, 0, 1] },
			},
			isBypass: false,
		} satisfies EffectNodeOf<typeof fillEffectDef>, {
			id: genId(),
			type: 'globalOut',
			inputs: { [initialOutputId]: {
				nodeId: initialEffectNodeId,
				outputPort: 'output',
			} },
		}],
	} satisfies ProjectVisualModule;

	await appReady({
		id: genId(),
		gsVersion: _VERSION_,
		name: DEFAULT_PROJECT_NAME,
		description: '',
		author: '',
		visualModules: [initialVisualModule],
		assets: [asset],
		players: player ? [player] : [],
		timelineScenes: [{ id: genId(), name: 'Main Scene', resolution: { mode: 'project' }, layers: [{
			id: genId(),
			layerType: 'visualModule',
			isDisabled: false,
			visualModuleId: initialVisualModule.id,
			visualModuleParamValues: {},
			compositingParamValues: deepClone({
				fitMode: timelineCompositingParamDefs.fitMode.defaultValue,
				blendMode: timelineCompositingParamDefs.blendMode.defaultValue,
				opacity: timelineCompositingParamDefs.opacity.defaultValue,
				position: timelineCompositingParamDefs.position.defaultValue,
				origin: timelineCompositingParamDefs.origin.defaultValue,
				scale: timelineCompositingParamDefs.scale.defaultValue,
				rotation: timelineCompositingParamDefs.rotation.defaultValue,
			}),
			automationGraphs: [],
			name: 'Visual Module', clips: [{ id: genId(), ...createTimelineClipTiming(0, 1000 * 10) }],
		}] }],
		timelineFps: DEFAULT_TIMELINE_FPS,
		timelineMotionBlur: { ...DEFAULT_TIMELINE_MOTION_BLUR },
		resolution: { width: result.width || 1024, height: result.height || 1024 },
	});

	return true;
}

export const workspacePanelDraggingContext = {
	draggingId: ref<string | null>(null),
};

export const timelineSubPanelTeleportTargetAvailable = ref(false);

const keymap = {
	'space': () => {
		if (previewPlayback.isTimelinePlaying.value) {
			previewPlayback.pauseTimeline();
		} else {
			previewPlayback.playTimeline();
		}
	},
} as const satisfies Keymap;
const listener = makeHotkey(keymap);
window.document.addEventListener('keydown', listener, { passive: false });
