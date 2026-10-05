import { createTimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import { visualModuleCustomParameterId, visualModuleCustomParameterName } from '@gs/subsystems_visual-module_shared/types.ts';
import { computed, ref, markRaw, watch } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { genId } from '@gs/shared/utility/id.ts';
import fillEffectDef from '@gs/subsystems_effect_shared/fx/fill/_def_.ts';
import imageEffectDef from '@gs/subsystems_effect_shared/fx/image/_def_.ts';
import videoEffectDef from '@gs/subsystems_effect_shared/fx/video/_def_.ts';
import audioWaveformEffectDef from '@gs/subsystems_effect_shared/fx/audioWaveform/_def_.ts';
import { DEFAULT_TIMELINE_FPS, DEFAULT_TIMELINE_MOTION_BLUR } from './project-defaults.ts';
import { DEFAULT_PROJECT_NAME, loadProjectFile } from './gsproj.ts';
import { makeHotkey } from './utility/hotkey.ts';
import { AppContext } from './AppContext.ts';
import { ProjectContext } from './Project.ts';
import type { ProjectAsset } from './Project.ts';
import type { Keymap } from './utility/hotkey.ts';
import type { ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';
import type { EffectNodeOf } from '@gs/subsystems_visual-module_shared/types.ts';
import type { Player } from '@gs/shared/types.ts';
import type { ProjectFileHandle } from './gsproj.ts';
import * as ui from '@/ui.ts';
import * as api from '@/api.ts';

export const appContext = new AppContext(new ProjectContext());

watch(() => appContext.projectContext.stateManager.state.name.value, name => {
	window.document.title = name ? `Glitch Studio (${name})` : 'Glitch Studio';
}, { immediate: true });

(window as any).appContext = appContext; // debug

function benchmark(count = 100, visualModuleId = appContext.projectContext.stateManager.state.visualModules.value[0]?.id) {
	if (visualModuleId == null) return;
	for (let i = 0; i < count; i++) {
		appContext.projectContext.stateManager.commit('addEffectNode', {
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

export const rendererEnv = {
	mouseX: 0,
	mouseY: 0,
};

export async function openProject(file?: File, fileHandle?: ProjectFileHandle): Promise<boolean> {
	try {
		const result = await loadProjectFile(file, fileHandle);
		if (result == null) return false;
		await appContext.ready(result.project, result.name, result.handle);
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
	await appContext.ready({
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
		sourceFilePath: result.sourceFilePath,
		hash: result.hash,
	} satisfies ProjectAsset;

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

	await appContext.ready({
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
		if (appContext.previewPlayback.isTimelinePlaying.value) {
			appContext.previewPlayback.pauseTimeline();
		} else {
			appContext.previewPlayback.playTimeline();
		}
	},
} as const satisfies Keymap;
const listener = makeHotkey(keymap);
window.document.addEventListener('keydown', listener, { passive: false });
