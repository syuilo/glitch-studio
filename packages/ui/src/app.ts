import { ref, markRaw, reactive, watch, shallowRef, triggerRef, computed } from 'vue';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { genId } from '@glitch/shared/utility/id.ts';
import { loadProjectFile, saveProjectFile, decodeAssets } from './api.ts';
import { Engine } from './engine.ts';
import { preferences } from './preferences.ts';
import { COMMAND_DEFS } from './commands.ts';
import GsEffectPicker from './components/GsEffectPicker.vue';
import type { CommandDef } from './commands.ts';
import type { AppState } from './types.ts';
import type { Asset, GsNode, Macro, GsAutomation, GsGroupNode, Player, NodeGraph } from '@glitch/shared/types.ts';
import type { RawProject } from './settings.ts';
import * as ui from '@/ui.ts';
import * as api from '@/api.ts';

type CommandLog = {
	type: string;
	date: number;
	execute: (state: AppState) => void;
	undo: (state: AppState) => void;
	mergeKey?: string | null;
};

class AppContext {
	public projectId: string | null = null;
	public projectName: string | null = null;
	public projectAuthor: string | null = null;
	public state: AppState;
	public undoStack = shallowRef([] as CommandLog[]);
	public redoStack = shallowRef([] as CommandLog[]);
	public canUndo = computed(() => this.undoStack.value.length > 0);
	public canRedo = computed(() => this.redoStack.value.length > 0);
	private maxUndoStackSize = 100;

	constructor() {
		this.state = {
			resolution: ref<{ width: number; height: number }>({ width: 1024, height: 1024 }),
			assets: ref<Asset[]>([]), // TODO: バイナリをリアクティブでwrapするのをやめる
			players: ref<Player[]>([]),
			nodeGraphs: ref<NodeGraph[]>([]),
			macros: ref<Macro[]>([]),
			automations: ref<GsAutomation[]>([]),
		};
	}

	public commit<T extends keyof typeof COMMAND_DEFS>(type: T, payload: Parameters<typeof COMMAND_DEFS[T]['create']>[0], mergeKey?: string | null) {
		const commandDef = COMMAND_DEFS[type] as CommandDef<any>;
		const command = commandDef.create(deepClone(payload));
		command.execute(this.state);

		const latest = this.undoStack.value.at(-1);
		if (latest != null && mergeKey != null && latest.mergeKey === mergeKey) {
			latest.execute = command.execute;
		} else {
			this.undoStack.value.push({
				type,
				date: Date.now(),
				execute: command.execute,
				undo: command.undo,
				mergeKey,
			});
			if (this.undoStack.value.length > this.maxUndoStackSize) {
				this.undoStack.value.shift();
			}
			triggerRef(this.undoStack);
			console.log('Committed command:', type, deepClone(payload));
		}

		this.redoStack.value = [];
		triggerRef(this.redoStack);
	}

	public undo() {
		const command = this.undoStack.value.pop();
		triggerRef(this.undoStack);
		if (command == null) return;
		command.undo(this.state);
		this.redoStack.value.push(command);
		triggerRef(this.redoStack);
	}

	public redo() {
		const command = this.redoStack.value.pop();
		triggerRef(this.redoStack);
		if (command == null) return;
		command.execute(this.state);
		this.undoStack.value.push(command);
		triggerRef(this.undoStack);
	}
}

export const appContext = new AppContext();

(window as any).appContext = appContext; // debug

export const wireMap = reactive<{
	in: Record<string, any>;
	out: Record<string, Record<string, HTMLElement>>;
	allIn: Record<string, HTMLElement>;
}>({
	in: {},
	out: {},
	allIn: {},
});

export function showAddNodeMenu(ev: PointerEvent, group?: GsGroupNode) {
	const { dispose } = ui.popup(GsEffectPicker, {
	}, {
		'chosen': effect => {
			appContext.commit('addEffectNode', {
				groupId: group?.id,
				effectId: effect.id,
				id: genId(),
			});
		},
		closed: () => {
			dispose();
		},
	});
}

function benchmark(count = 100) {
	for (let i = 0; i < count; i++) {
		appContext.commit('addEffectNode', {
			effectId: 'blockShuffle',
			id: genId(),
			params: {
				seed: { type: 'literal', value: Math.random() * 1000 },
			},
		});
	}
}

(window as any).benchmark = benchmark; // debug

export const fpsLimit = ref<number | null>(60);
export const timeFactor = ref(1);
export const resolutionFactor = ref(1);
export const highlightClipping = ref(false);

export const rendererEnv = {
	mouseX: 0,
	mouseY: 0,
};
export const engine = markRaw(new Engine({
	fpsLimit: fpsLimit.value,
	timeFactor: timeFactor.value,
	highlightClipping: highlightClipping.value,
}));

watch(highlightClipping, value => {
	engine.setHighlightClipping(value);
});

(window as any).engine = engine; // debug

watch(fpsLimit, () => {
	engine.changeFpsLimit(fpsLimit.value);
});

watch(timeFactor, value => {
	engine.setTimeFactor(value);
});

watch([appContext.state.resolution, resolutionFactor], () => {
	engine.resize({
		width: Math.round(appContext.state.resolution.value.width * resolutionFactor.value), // 解像度が少数になるとバグるので丸める
		height: Math.round(appContext.state.resolution.value.height * resolutionFactor.value), // 解像度が少数になるとバグるので丸める
	});
});

export async function appReady(project: RawProject) {
	window.document.title = `Glitch Studio (${project.name})`;

	await engine.init({
		width: Math.round(appContext.state.resolution.value.width * resolutionFactor.value), // 解像度が少数になるとバグるので丸める
		height: Math.round(appContext.state.resolution.value.height * resolutionFactor.value), // 解像度が少数になるとバグるので丸める
	});

	appContext.projectId = project.id;
	appContext.projectName = project.name;
	appContext.projectAuthor = project.author;
	appContext.state.resolution.value = project.resolution;
	appContext.state.assets.value = await decodeAssets(project.assets);
	appContext.state.nodeGraphs.value = project.nodeGraphs;
	appContext.state.macros.value = project.macros;
	appContext.state.automations.value = project.automations;

	watch(appContext.state.automations, () => {
		engine.updateAutomations(deepClone(appContext.state.automations.value));
	}, { deep: true, immediate: true });

	watch(appContext.state.assets, () => {
		engine.updateAssets(deepClone(appContext.state.assets.value));
	}, { deep: true, immediate: true });

	watch(appContext.state.players, () => {
		engine.updatePlayers(deepClone(appContext.state.players.value));
	}, { deep: true, immediate: true });

	watch(appContext.state.nodeGraphs, () => {
		engine.updateNodeGraphs(deepClone(appContext.state.nodeGraphs.value));
	}, { deep: true, immediate: true });

	watch(appContext.state.macros, () => {
		engine.updateMacros(deepClone(appContext.state.macros.value));
	}, { deep: true, immediate: true });

	engine.startRenderLoop();
}

export function saveProject() {
	//saveProjectFile({
	//	id: store.id,
	//	gsVersion: _VERSION_,
	//	name: store.name,
	//	author: store.author,
	//	macros: store.macros,
	//	nodes: store.nodes,
	//	automations: store.automations,
	//	renderWidth: store.renderWidth,
	//	renderHeight: store.renderHeight,
	//	assets: store.assets.map(asset => ({
	//		id: asset.id,
	//		name: asset.name,
	//		width: asset.width,
	//		height: asset.height,
	//		fileDataType: asset.fileDataType,
	//		fileData: asset.fileData,
	//		hash: asset.hash,
	//	})),
	//});
}

export async function openProject() {
	const { project, name } = await loadProjectFile();

	console.log('project', project);

	await appReady(project);
}

export async function newProject() {
	await appReady({
		id: genId(),
		gsVersion: _VERSION_,
		name: 'untitled',
		author: 'TODO',
		nodes: [],
		assets: [],
		macros: [],
		automations: [],
		resolution: { width: 1024, height: 1024 },
	});
}

export async function newProjectFromImageOrVideo(file?: File) {
	const result = await api.openMediaFile({ file });
	if (result == null) return false;

	const assetId = genId();

	if (result.width > 1500 || result.height > 1500) {
		resolutionFactor.value = 0.5;
	}
	if (result.width > 3000 || result.height > 3000) {
		resolutionFactor.value = 0.25;
	}

	await appReady({
		id: genId(),
		gsVersion: _VERSION_,
		name: result.name,
		author: 'TODO',
		nodes: [],
		assets: [],
		macros: [],
		automations: [],
		resolution: { width: result.width || 1024, height: result.height || 1024 },
	});

	appContext.commit('addAsset', {
		id: assetId,
		name: result.name,
		width: result.width,
		height: result.height,
		data: result.data,
		fileDataType: result.type,
		fileData: result.fileData,
		hash: result.hash,
	});

	if (result.type.startsWith('image/')) {
		appContext.commit('addEffectNode', {
			effectId: 'image',
			id: genId(),
			params: {
				image: { type: 'literal', value: assetId },
			},
		});
	} else if (result.type.startsWith('video/') || result.type.startsWith('audio/')) {
		const playerId = genId();

		appContext.commit('addPlayer', {
			id: playerId,
			name: result.name,
			type: 'asset',
			assetId: assetId,
		});

		appContext.commit('addEffectNode', {
			effectId: result.type.startsWith('audio/') ? 'audioWaveform' : 'video',
			id: genId(),
			params: {
				player: { type: 'literal', value: playerId },
			},
		});
	}

	return true;
}

export const workspacePanelDraggingContext = {
	draggingId: ref<string | null>(null),
};
