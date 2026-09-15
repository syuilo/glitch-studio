import { ref, markRaw, reactive, watch, shallowRef, triggerRef } from 'vue';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { genId } from '@glitch/shared/utility/id.ts';
import { loadProjectFile, saveProjectFile, decodeAssets } from './api.ts';
import { Engine } from './engine.ts';
import { COMMAND_DEFS } from './commands.ts';
import GsEffectPicker from './components/GsEffectPicker.vue';
import type { CommandDef } from './commands.ts';
import type { AppState } from './types.ts';
import type { WorkspaceDivider } from './types/workspace.ts';
import type { Asset, GsNode, Macro, GsAutomation, GsGroupNode, Player } from '@glitch/shared/types.ts';
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
	private maxUndoStackSize = 100;

	// とりあえずundo/redo対象にする必要なさそうだからstate外で管理
	public workspaceDefinition = ref<WorkspaceDivider>({
		id: 'root',
		ratio: 1,
		type: null,
		direction: 'horizontal',
		children: [{
			id: 'c138f76ec1d84ba5b83b0cc3766a1266',
			ratio: 0.7,
			type: null,
			direction: 'vertical',
			children: [{
				id: '938e3eedc00d4287885b6894ee3ea8c3',
				ratio: 0.6,
				type: null,
				direction: 'horizontal',
				children: [{
					id: '53ef52d7a5a44b41ba34a0491b4f5d8e',
					ratio: 0.25,
					type: null,
					direction: 'vertical',
					children: [{
						id: '0f34c5f4c9cb449683c7f1281851b759',
						ratio: 0.33,
						type: 'histogram',
					}, {
						id: 'b3d6059aaa554ae79441286cd2beb685',
						ratio: 0.33,
						type: 'audioWaveform',
					}, {
						id: '47edf72197d94d28b6b2811bfecc97e5',
						ratio: 0.33,
						type: 'stats',
					}],
				}, {
					id: '5ec0a586d9654755acdaa2ae6837f28e',
					ratio: 0.75,
					type: 'preview',
				}],
			}, {
				id: '8aec4dd7bf82460eba420680fda4f652',
				ratio: 0.4,
				type: null,
				direction: 'vertical',
				children: [{
					id: 'ba8f8efaa9a54a109340b2f3e329cda2',
					ratio: 0.5,
					type: null,
					direction: 'horizontal',
					children: [{
						id: '251858d938b0448aafd613b73c7e352c',
						ratio: 0.25,
						type: 'audioSpectrogram',
					}, {
						id: '136c0ccc916c438787756c07da414be7',
						ratio: 0.25,
						type: 'waveformHorizontal',
					}, {
						id: 'ca5eba2936d4423891377972de6a41f5',
						ratio: 0.25,
						type: 'waveformVertical',
					}, {
						id: '15bd089777d440a0baaf2953c8020e24',
						ratio: 0.25,
						type: 'players',
					}],
				}, {
					id: '2d9d8a38ce9a4d24bc70a500f892f124',
					ratio: 0.5,
					type: 'timeline',
				}],
			}],
		}, {
			id: '441518aeb37940b2af7fb0027fd530a9',
			ratio: 0.3,
			type: 'nodesEditor',
		}],
	});

	constructor() {
		this.state = {
			resolution: ref<{ width: number; height: number }>({ width: 1024, height: 1024 }),
			assets: ref<Asset[]>([]), // TODO: バイナリをリアクティブでwrapするのをやめる
			players: ref<Player[]>([]),
			nodes: ref<GsNode[]>([]),
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

export const fpsLimit = ref(60);
export const resolutionFactor = ref(1);

export const rendererEnv = {
	mouseX: 0,
	mouseY: 0,
};
export const engine = markRaw(new Engine({
	fpsLimit: fpsLimit.value,
}));

(window as any).engine = engine; // debug

watch(fpsLimit, () => {
	engine.changeFpsLimit(fpsLimit.value);
});

watch([appContext.state.resolution, resolutionFactor], () => {
	engine.resize({
		width: appContext.state.resolution.value.width * resolutionFactor.value,
		height: appContext.state.resolution.value.height * resolutionFactor.value,
	});
});

export async function appReady(project: RawProject) {
	window.document.title = `Glitch Studio (${project.name})`;

	await engine.init({
		width: appContext.state.resolution.value.width * resolutionFactor.value,
		height: appContext.state.resolution.value.height * resolutionFactor.value,
	});

	appContext.projectId = project.id;
	appContext.projectName = project.name;
	appContext.projectAuthor = project.author;
	appContext.state.resolution.value = project.resolution;
	appContext.state.assets.value = await decodeAssets(project.assets);
	appContext.state.nodes.value = project.nodes;
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

	watch(appContext.state.nodes, () => {
		engine.updateNodes(deepClone(appContext.state.nodes.value));

		//// TODO: グループ考慮
		//if (store.nodes.some(n => n.type === 'effect' && n.effectId === 'webcamera')) {
		//	glitchRenderer.setupWebcam();
		//}
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
	if (result == null) return;

	const assetId = genId();

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
}

export const workspacePanelDraggingContext = {
	draggingId: ref<string | null>(null),
};
