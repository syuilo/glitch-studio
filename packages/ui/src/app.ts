import { visualModuleCustomParameterId, visualModuleCustomParameterName } from '@glitch/shared/visual-module/types.ts';
import { ref, markRaw, reactive, watch } from 'vue';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { timelineCompositingParamDefs } from '@glitch/shared/timeline/timeline-compositing.ts';
import { genId } from '@glitch/shared/utility/id.ts';
import fillEffectDef from '@glitch/shared/effect/fx/fill/_def_.ts';
import imageEffectDef from '@glitch/shared/effect/fx/image/_def_.ts';
import videoEffectDef from '@glitch/shared/effect/fx/video/_def_.ts';
import audioWaveformEffectDef from '@glitch/shared/effect/fx/audioWaveform/_def_.ts';
import { RendererController } from './RendererController.ts';
import GsEffectPicker from './components/GsEffectPicker.vue';
import { PreviewPlaybackController } from './PreviewPlaybackController.ts';
import { AppStateManager } from './AppStateManager.ts';
import { DEFAULT_PROJECT_NAME, loadProjectFile, saveProjectFile } from './gsproj.ts';
import type { EffectNodeOf, VisualModule } from '@glitch/shared/visual-module/types.ts';
import type { Asset, Player } from '@glitch/shared/types.ts';
import type { Project } from './gsproj.ts';
import type { WatchStopHandle } from 'vue';
import * as ui from '@/ui.ts';
import * as api from '@/api.ts';

export const appStateManager = new AppStateManager();

watch(() => appStateManager.projectInfo.value.name, name => {
	window.document.title = name ? `Glitch Studio (${name})` : 'Glitch Studio';
}, { immediate: true });

(window as any).appStateManager = appStateManager; // debug

export const wireMap = reactive<{
	in: Record<string, any>;
	out: Record<string, Record<string, HTMLElement>>;
	allIn: Record<string, HTMLElement>;
}>({
	in: {},
	out: {},
	allIn: {},
});

export function showAddNodeMenu(visualModuleId: VisualModule['id'], ev: PointerEvent) {
	const { dispose } = ui.popup(GsEffectPicker, {
	}, {
		'chosen': effect => {
			appStateManager.commit('addEffectNode', {
				visualModuleId: visualModuleId,
				effectId: effect.id,
				id: genId(),
			});
		},
		closed: () => {
			dispose();
		},
	});
}

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
export const renderer = markRaw(new RendererController({
	fpsLimit: fpsLimit.value,
	liveTimeFactor: liveTimeFactor.value,
	highlightClipping: highlightClipping.value,
}));
export const previewPlayback = markRaw(new PreviewPlaybackController(renderer, () => fpsLimit.value));

// Worker再読み込み後も、停止中のタイムラインの現在位置を復元する。
watch(renderer.isReady, ready => {
	if (ready) previewPlayback.refresh();
});

watch(highlightClipping, value => {
	renderer.setHighlightClipping(value);
});

(window as any).renderer = renderer; // debug

watch(fpsLimit, () => {
	renderer.changeLiveModeFpsLimit(fpsLimit.value);
});

watch(liveTimeFactor, value => {
	renderer.setLiveTimeFactor(value);
});

watch([appStateManager.state.resolution, resolutionFactor], () => {
	renderer.resize({
		width: Math.round(appStateManager.state.resolution.value.width * resolutionFactor.value), // 解像度が少数になるとバグるので丸める
		height: Math.round(appStateManager.state.resolution.value.height * resolutionFactor.value), // 解像度が少数になるとバグるので丸める
	});
});

let rendererInitialization: Promise<void> | null = null;
let projectWatchers: WatchStopHandle[] = [];
let projectMetadata: Pick<Project, 'id'> | null = null;
let projectFileName = 'untitled.gsproj';
let projectFileHandle: FileSystemFileHandle | null = null;
let savingProject = false;

export async function appReady(project: Project, fileName = 'untitled.gsproj', fileHandle: FileSystemFileHandle | null = null) {
	// CanvasのOffscreen転送は一度だけ行い、別のプロジェクトを開くときもWorkerを再利用する。
	rendererInitialization ??= renderer.init({
		width: Math.round(project.resolution.width * resolutionFactor.value), // 解像度が少数になるとバグるので丸める
		height: Math.round(project.resolution.height * resolutionFactor.value), // 解像度が少数になるとバグるので丸める
	});
	await rendererInitialization;

	// 読み込み途中の状態を、直前のプロジェクトのファイルへ保存させない。
	projectMetadata = null;
	projectFileHandle = null;
	for (const stop of projectWatchers) stop();
	projectWatchers = [];
	previewPlayback.dispose();
	// 同じIDのプロジェクトを再読込した場合も、以前の再生・ノード履歴を引き継がない。
	await renderer.updatePlayers([]);
	renderer.updateVisualModules([]);
	renderer.updateTimeline([]);

	appStateManager.state.resolution.value = project.resolution;
	appStateManager.state.assets.value = project.assets;
	appStateManager.state.visualModules.value = project.visualModules;
	appStateManager.state.players.value = project.players;
	appStateManager.state.timeline.value = project.timeline;
	appStateManager.undoStack.value = [];
	appStateManager.redoStack.value = [];
	await renderer.updateAssets(deepClone(project.assets));
	await renderer.updatePlayers(deepClone(project.players));
	renderer.updateVisualModules(deepClone(project.visualModules));
	renderer.updateTimeline(deepClone(project.timeline));
	projectMetadata = { id: project.id };
	appStateManager.projectInfo.value = { name: project.name, description: project.description, author: project.author };
	projectFileName = fileName;
	projectFileHandle = fileHandle;

	projectWatchers.push(watch(appStateManager.state.assets, async () => {
		try {
			await renderer.updateAssets(deepClone(appStateManager.state.assets.value));
			// 非同期の画像準備後にも、停止中のタイムラインを描き直す。
			previewPlayback.refresh();
		} catch (error) {
			void ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
		}
	}, { deep: true }));

	projectWatchers.push(watch(appStateManager.state.players, () => {
		renderer.updatePlayers(deepClone(appStateManager.state.players.value));
	}, { deep: true }));

	projectWatchers.push(watch(appStateManager.state.visualModules, () => {
		renderer.updateVisualModules(deepClone(appStateManager.state.visualModules.value));
		// 停止中は時刻が変化しないため、モジュールの編集・Undo/Redoでも現在位置を描き直す。
		// 単体のLIVEプレビュー中は、その描画ループを維持する。
		previewPlayback.refresh();
	}, { deep: true }));

	projectWatchers.push(watch(appStateManager.state.timeline, () => {
		renderer.updateTimeline(deepClone(appStateManager.state.timeline.value));
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
			...appStateManager.projectInfo.value,
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
	const initialVisualModule: VisualModule = {
		id: genId(),
		name: 'My Visual Module',
		automationGraphs: [],
		outputDefs: [{ id: initialOutputId, label: 'Output', name: 'output', dataType: { kind: 'color' }, isPrimaryOutput: true }],
		paramDefs: [{
			id: initialInputParamId,
			nameForReference: visualModuleCustomParameterName('myInput'),
			dataType: { kind: 'color' },
			ui: { label: 'My Input', control: {} },
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
			canNode: true,
			isPrimaryInput: true,
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
	} satisfies VisualModule;
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
			endTimeMs: 1000 * 10,
		}],
		resolution: { width: 1024, height: 1024 },
	});
}

export async function newProjectFromImageOrVideo(file?: File) {
	const result = await api.openMediaFile({ file });
	if (result == null) return false;
	if (result.width > 1500 || result.height > 1500) {
		resolutionFactor.value = 0.5;
	}
	if (result.width > 3000 || result.height > 3000) {
		resolutionFactor.value = 0.25;
	}

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
	const initialVisualModule: VisualModule = {
		id: genId(),
		name: 'My Visual Module',
		automationGraphs: [],
		outputDefs: [{ id: initialOutputId, label: 'Output', name: 'output', dataType: { kind: 'color' }, isPrimaryOutput: true }],
		paramDefs: [{
			id: initialInputParamId,
			nameForReference: visualModuleCustomParameterName('myInput'),
			dataType: { kind: 'color' },
			ui: { label: 'My Input', control: {} },
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
			canNode: true,
			isPrimaryInput: true,
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
	} satisfies VisualModule;

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
			endTimeMs: 1000 * 10,
		}],
		resolution: { width: result.width || 1024, height: result.height || 1024 },
	});

	return true;
}

export const workspacePanelDraggingContext = {
	draggingId: ref<string | null>(null),
};
