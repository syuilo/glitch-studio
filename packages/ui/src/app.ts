import { ref, markRaw, reactive, watch, shallowRef, triggerRef, computed } from 'vue';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { genId } from '@glitch/shared/utility/id.ts';
import fillEffectDef from '@glitch/shared/effects/fill/_def_.ts';
import imageEffectDef from '@glitch/shared/effects/image/_def_.ts';
import videoEffectDef from '@glitch/shared/effects/video/_def_.ts';
import audioWaveformEffectDef from '@glitch/shared/effects/audioWaveform/_def_.ts';
import { loadProjectFile } from './api.ts';
import { Engine } from './engine.ts';
import { preferences } from './preferences.ts';
import { COMMAND_DEFS } from './commands.ts';
import GsEffectPicker from './components/GsEffectPicker.vue';
import { currentTimelineTime } from './timeline.ts';
import type { CommandDef } from './commands.ts';
import type { AppState } from './types.ts';
import type { EffectNodeOf } from '@glitch/shared/effect-definition.ts';
import type { Asset, Player, VisualModule, Timeline } from '@glitch/shared/types.ts';
import type { Project } from './gsproj.ts';
import * as ui from '@/ui.ts';
import * as api from '@/api.ts';

type CommandLog = {
	type: keyof typeof COMMAND_DEFS;
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
			visualModules: ref<VisualModule[]>([]),
			timeline: ref<Timeline>([]),
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

	public getVisualModuleById(id: VisualModule['id']) {
		return this.state.visualModules.value.find(vm => vm.id === id) ?? null;
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

export function showAddNodeMenu(visualModuleId: VisualModule['id'], ev: PointerEvent) {
	const { dispose } = ui.popup(GsEffectPicker, {
	}, {
		'chosen': effect => {
			appContext.commit('addEffectNode', {
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

function benchmark(count = 100, visualModuleId = appContext.state.visualModules.value[0]?.id) {
	if (visualModuleId == null) return;
	for (let i = 0; i < count; i++) {
		appContext.commit('addEffectNode', {
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
export const engine = markRaw(new Engine({
	fpsLimit: fpsLimit.value,
	liveTimeFactor: liveTimeFactor.value,
	highlightClipping: highlightClipping.value,
}));

watch(highlightClipping, value => {
	engine.setHighlightClipping(value);
});

(window as any).engine = engine; // debug

watch(fpsLimit, () => {
	engine.changeLiveModeFpsLimit(fpsLimit.value);
});

watch(liveTimeFactor, value => {
	engine.setLiveTimeFactor(value);
});

watch([appContext.state.resolution, resolutionFactor], () => {
	engine.resize({
		width: Math.round(appContext.state.resolution.value.width * resolutionFactor.value), // 解像度が少数になるとバグるので丸める
		height: Math.round(appContext.state.resolution.value.height * resolutionFactor.value), // 解像度が少数になるとバグるので丸める
	});
});

export async function appReady(project: Project) {
	window.document.title = `Glitch Studio (${project.name})`;

	await engine.init({
		width: Math.round(appContext.state.resolution.value.width * resolutionFactor.value), // 解像度が少数になるとバグるので丸める
		height: Math.round(appContext.state.resolution.value.height * resolutionFactor.value), // 解像度が少数になるとバグるので丸める
	});

	appContext.projectId = project.id;
	appContext.projectName = project.name;
	appContext.projectAuthor = project.author;
	appContext.state.resolution.value = project.resolution;
	appContext.state.assets.value = project.assets;
	appContext.state.visualModules.value = project.visualModules;
	appContext.state.players.value = project.players;
	appContext.state.timeline.value = project.timeline;

	watch(appContext.state.assets, () => {
		engine.updateAssets(deepClone(appContext.state.assets.value));
	}, { deep: true, immediate: true });

	watch(appContext.state.players, () => {
		engine.updatePlayers(deepClone(appContext.state.players.value));
	}, { deep: true, immediate: true });

	watch(appContext.state.visualModules, () => {
		engine.updateVisualModules(deepClone(appContext.state.visualModules.value));
	}, { deep: true, immediate: true });

	watch(currentTimelineTime, () => {
		engine.renderTimelineAt(currentTimelineTime.value);
	}, { deep: true, immediate: true });

	watch(appContext.state.timeline, () => {
		engine.updateTimeline(deepClone(appContext.state.timeline.value));
		// 停止中は時刻のwatchが発火しないため、編集・Undo/Redo後も現在位置を描き直す
		engine.renderTimelineAt(currentTimelineTime.value);
	}, { deep: true, immediate: true });

	engine.startLiveRenderLoopFor(project.visualModules[0].id);
}

export function saveProject() {
	// TODO
}

export async function openProject() {
	const result = await loadProjectFile();
	if (result == null) return;
	const { project } = result;

	console.log('project', project);

	await appReady(project);
}

export async function newProject() {
	const initialEffectNodeId = genId();
	const initialInputParamId = genId();
	const initialOutputId = genId();
	const initialVisualModule: VisualModule = {
		id: genId(),
		name: 'My Visual Module',
		automationGraphs: [],
		outputDefs: [{ id: initialOutputId, label: 'Output', name: 'output', dataType: 'color', isPrimaryOutput: true }],
		paramDefs: [{
			id: initialInputParamId,
			name: 'myInput',
			dataType: 'color',
			ui: { label: 'My Input', control: 'color' },
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
		name: 'untitled',
		author: 'TODO',
		visualModules: [initialVisualModule],
		assets: [],
		players: [],
		timeline: [{
			id: genId(),
			layerType: 'visualModule',
			visualModuleId: initialVisualModule.id,
			paramValues: {},
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
		data: result.data,
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
	const initialInputParamId = genId();
	const initialOutputId = genId();
	const initialVisualModule: VisualModule = {
		id: genId(),
		name: 'My Visual Module',
		automationGraphs: [],
		outputDefs: [{ id: initialOutputId, label: 'Output', name: 'output', dataType: 'color', isPrimaryOutput: true }],
		paramDefs: [{
			id: initialInputParamId,
			name: 'myInput',
			dataType: 'color',
			ui: { label: 'My Input', control: 'color' },
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
		name: result.name,
		author: 'TODO',
		visualModules: [initialVisualModule],
		assets: [asset],
		players: player ? [player] : [],
		timeline: [{
			id: genId(),
			layerType: 'visualModule',
			visualModuleId: initialVisualModule.id,
			paramValues: {},
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
