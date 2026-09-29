import { visualModuleCustomParameterId, visualModuleCustomParameterName } from '@glitch/shared/visual-module/types.ts';
import { computed, ref, markRaw, watch } from 'vue';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { deepEqual } from '@glitch/shared/utility/deep-equal.ts';
import { timelineCompositingParamDefs } from '@glitch/shared/timeline/timeline-compositing.ts';
import { genId } from '@glitch/shared/utility/id.ts';
import fillEffectDef from '@glitch/shared/effect/fx/fill/_def_.ts';
import imageEffectDef from '@glitch/shared/effect/fx/image/_def_.ts';
import videoEffectDef from '@glitch/shared/effect/fx/video/_def_.ts';
import audioWaveformEffectDef from '@glitch/shared/effect/fx/audioWaveform/_def_.ts';
import { VisualModuleRendererManagerController } from './VisualModuleRendererManagerController.ts';
import { TimelineRendererManagerController } from './TimelineRendererManagerController.ts';
import type { TimelineRendererManagerDynamicOptions } from '@glitch/renderer/timeline-renderer-manager.ts';
import type { ProjectVisualModule } from '@glitch/shared/project/types.ts';
import { TimelineAudioPreview } from './audio/timeline-audio-preview.ts';
import { AudioOutput } from './audio/audio-output.ts';
import { PreviewPlaybackController } from './PreviewPlaybackController.ts';
import { AppStateManager } from './AppStateManager.ts';
import { DEFAULT_PROJECT_NAME, loadProjectFile, saveProjectFile } from './gsproj.ts';
import { preferences } from './preferences.ts';
import type { EffectNodeOf } from '@glitch/shared/visual-module/types.ts';
import type { Asset, IntermediateTextureFormat, Player } from '@glitch/shared/types.ts';
import type { Project, ProjectInfo } from './gsproj.ts';
import type { WatchStopHandle } from 'vue';
import * as ui from '@/ui.ts';
import * as api from '@/api.ts';

export const appStateManager = new AppStateManager();
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

export const fpsLimit = ref<number | null>(60);
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
	fpsLimit: fpsLimit.value,
	liveTimeFactor: liveTimeFactor.value,
	highlightClipping: highlightClipping.value,
}, audioOutput));

export const timelineRendererManagerController = markRaw(new TimelineRendererManagerController({
	enable32bitDataTextures: preferences.s.enable32bitDataTextures,
	intermediateTextureFormat: getRendererIntermediateTextureFormat(),
}, { highlightClipping: highlightClipping.value }));

export const timelineAudioPreview = markRaw(new TimelineAudioPreview(
	() => audioOutput.getOutput(),
	() => ({ assets: deepClone(appStateManager.state.assets.value), timeline: deepClone(appStateManager.state.timeline.value) }),
));
export const previewPlayback = markRaw(new PreviewPlaybackController(
	visualModuleRendererManagerController, timelineRendererManagerController, () => fpsLimit.value,
	() => appStateManager.state.timeline.value.reduce((end, layer) => Math.max(end, layer.startTimeMs + layer.durationMs), 0), timelineAudioPreview,
));
export const activePreviewRenderer = computed(() => previewPlayback.state.value.mode === 'live'
	? visualModuleRendererManagerController : timelineRendererManagerController);

async function updatePreviewOptions(options: Partial<Pick<TimelineRendererManagerDynamicOptions, 'assets' | 'visualModules' | 'resolution' | 'highlightClipping'>>) {
	await Promise.all([
		visualModuleRendererManagerController.updateDynamicOptions(options),
		timelineRendererManagerController.updateDynamicOptions(options),
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

watch(fpsLimit, () => {
	visualModuleRendererManagerController.updateDynamicOptions({ fpsLimit: fpsLimit.value });
});

watch(liveTimeFactor, value => {
	visualModuleRendererManagerController.updateDynamicOptions({ liveTimeFactor: value });
});

watch([appStateManager.state.resolution, resolutionFactor], async () => {
	await updatePreviewOptions({
		resolution: {
			width: Math.round(appStateManager.state.resolution.value.width * resolutionFactor.value), // 解像度が少数になるとバグるので丸める
			height: Math.round(appStateManager.state.resolution.value.height * resolutionFactor.value), // 解像度が少数になるとバグるので丸める
		},
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
	// 画像からの新規作成とプロジェクト読込で同じ基準を使い、初回のGPU初期化にも反映する。
	const maxDimension = Math.max(project.resolution.width, project.resolution.height);
	const initialResolutionFactor = maxDimension > 3000 ? 0.25 : maxDimension > 1500 ? 0.5 : 1;
	// CanvasのOffscreen転送は一度だけ行い、別のプロジェクトを開くときもWorkerを再利用する。
	rendererInitialization ??= Promise.all([visualModuleRendererManagerController, timelineRendererManagerController].map(controller => controller.init({
		width: Math.round(project.resolution.width * initialResolutionFactor), // 解像度が少数になるとバグるので丸める
		height: Math.round(project.resolution.height * initialResolutionFactor), // 解像度が少数になるとバグるので丸める
	}))).then(() => {});
	await rendererInitialization;

	// 読み込み途中の状態を、直前のプロジェクトのファイルへ保存させない。
	projectMetadata = null;
	projectFileHandle = null;
	for (const stop of projectWatchers) stop();
	projectWatchers = [];
	previewPlayback.dispose();
	// 同じIDのプロジェクトを再読込した場合も、以前の再生・ノード履歴を引き継がない。
	await updatePreviewOptions({ assets: [], visualModules: [] });
	await timelineRendererManagerController.updateDynamicOptions({ timeline: [] });
	await visualModuleRendererManagerController.updatePlayers([]);

	appStateManager.state.resolution.value = project.resolution;
	resolutionFactor.value = initialResolutionFactor;
	appStateManager.state.assets.value = project.assets;
	appStateManager.state.visualModules.value = project.visualModules;
	appStateManager.state.players.value = project.players;
	appStateManager.state.timeline.value = project.timeline;
	appStateManager.undoStack.value = [];
	appStateManager.redoStack.value = [];
	await updatePreviewOptions({
		assets: deepClone(project.assets),
		visualModules: deepClone(project.visualModules),
	});
	await timelineRendererManagerController.updateDynamicOptions({ timeline: deepClone(project.timeline) });
	await visualModuleRendererManagerController.updatePlayers(deepClone(project.players));
	projectMetadata = { id: project.id };
	projectInfo.value = { name: project.name, description: project.description, author: project.author };
	projectFileName = fileName;
	projectFileHandle = fileHandle;

	// 音声の内容・参照素材・ループ長だけを比較する。Blobは不変なので同一性で判定し、
	// 素材名や映像パラメータの編集では再生中のWorkerと先読みPCMを維持する。
	projectWatchers.push(watch(() => {
		const timeline = appStateManager.state.timeline.value;
		const layers = timeline.filter(layer => layer.layerType === 'audio');
		const assetIds = new Set(layers.map(layer => layer.assetId));
		return {
			layers: deepClone(layers),
			duration: timeline.reduce((end, layer) => Math.max(end, layer.startTimeMs + layer.durationMs), 0),
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

	projectWatchers.push(watch(appStateManager.state.visualModules, async () => {
		await updatePreviewOptions({ visualModules: deepClone(appStateManager.state.visualModules.value) });
		// 停止中は時刻が変化しないため、モジュールの編集・Undo/Redoでも現在位置を描き直す。
		// 単体のLIVEプレビュー中は、その描画ループを維持する。
		previewPlayback.refresh();
	}, { deep: true }));

	projectWatchers.push(watch(appStateManager.state.timeline, async () => {
		await timelineRendererManagerController.updateDynamicOptions({ timeline: deepClone(appStateManager.state.timeline.value) });
		// 編集・Undo/Redo後は現在位置を描き直す。LIVE中はその表示を維持する。
		previewPlayback.refresh();
	}, { deep: true }));

	previewPlayback.seekTimeline(0);
	if (project.visualModules[0] != null) previewPlayback.startLive(project.visualModules[0].id);
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
			timeline: appStateManager.state.timeline.value,
			resolution: appStateManager.state.resolution.value,
		} satisfies Project);
		const handle = await saveProjectFile(project, projectFileName, saveAs ? null : projectFileHandle);
		// 保存中に別プロジェクトを開いた場合、そのプロジェクトの保存先は変更しない。
		if (handle != null && projectMetadata === metadata) {
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
		timeline: [{
			id: genId(),
			layerType: 'visualModule',
			visualModuleId: initialVisualModule.id,
			paramValues: {},
			compositingParamValues: deepClone({
				blendMode: timelineCompositingParamDefs.blendMode.defaultValue,
				opacity: timelineCompositingParamDefs.opacity.defaultValue,
				translation: timelineCompositingParamDefs.translation.defaultValue,
				scale: timelineCompositingParamDefs.scale.defaultValue,
				rotation: timelineCompositingParamDefs.rotation.defaultValue,
			}),
			automationGraphs: [],
			startTimeMs: 0,
			durationMs: 1000 * 10,
		}],
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
			effectId: 'image',
			params: {
				image: { inputSource: 'literal', value: asset.id },
				sizeMode: deepClone(imageEffectDef.paramDefs.sizeMode.defaultValue),
			},
			isBypass: false,
		} satisfies EffectNodeOf<typeof imageEffectDef> : result.type.startsWith('video/') ? {
			id: initialEffectNodeId,
			type: 'effect',
			effectId: 'video',
			params: {
				player: { inputSource: 'literal', value: player!.id },
				sizeMode: deepClone(videoEffectDef.paramDefs.sizeMode.defaultValue),
			},
			isBypass: false,
		} satisfies EffectNodeOf<typeof videoEffectDef> : result.type.startsWith('audio/') ? {
			id: initialEffectNodeId,
			type: 'effect',
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
		timeline: [{
			id: genId(),
			layerType: 'visualModule',
			visualModuleId: initialVisualModule.id,
			paramValues: {},
			compositingParamValues: deepClone({
				blendMode: timelineCompositingParamDefs.blendMode.defaultValue,
				opacity: timelineCompositingParamDefs.opacity.defaultValue,
				translation: timelineCompositingParamDefs.translation.defaultValue,
				scale: timelineCompositingParamDefs.scale.defaultValue,
				rotation: timelineCompositingParamDefs.rotation.defaultValue,
			}),
			automationGraphs: [],
			startTimeMs: 0,
			durationMs: 1000 * 10,
		}],
		resolution: { width: result.width || 1024, height: result.height || 1024 },
	});

	return true;
}

export const workspacePanelDraggingContext = {
	draggingId: ref<string | null>(null),
};
