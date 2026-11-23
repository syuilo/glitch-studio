import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { createTimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { genId } from '@gs/shared/utility/id.ts';
import imageEffectDef from '@gs/subsystems_effect_native-effects/fx/image/_def_.ts';
import { DEFAULT_TIMELINE_FPS, DEFAULT_TIMELINE_MOTION_BLUR } from './project-defaults.ts';
import { DEFAULT_PROJECT_NAME, selectProjectFile } from './gsproj.ts';
import { recentProjects } from './recent-projects.ts';
import type { ProjectSessionManager } from './ProjectSessionManager.ts';
import { createTimelineAssetLayer } from './utility/timeline-asset-layer.ts';
import { inspectTimelineClipMedia } from './utility/timeline-clip-media.ts';
import { readVideoFrameRate } from './utility/video-frame-rate.ts';
import type { ProjectAsset } from './Project.ts';
import type { ProjectNodesEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { Project, ProjectFileHandle } from './gsproj.ts';
import type { OpenedMediaFile } from './api.ts';
import { i18n } from '@/i18n.ts';
import * as ui from '@/ui.ts';
import { openMediaFile, openMediaFileFromPath } from '@/utility/open-media-file.ts';

/** ファイル選択・初期データ作成を行い、新しい編集セッションとして追加する。 */
export function createProjectActions(projectSessions: ProjectSessionManager) {
	async function openProject(file?: File | null, fileHandle?: ProjectFileHandle | null, recentProjectId?: string): Promise<boolean> {
		try {
			const session = await projectSessions.openFile(async sessionId => {
				if (recentProjectId != null) {
					fileHandle = await recentProjects.resolve(recentProjectId, sessionId);
					if (fileHandle == null) return null;
				}
				return selectProjectFile({ file, handle: fileHandle, reservationId: sessionId });
			});
			return session != null;
		} catch (error) {
			console.error(error);
			await ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
			return false;
		}
	}

	async function newProject() {
		const initialEffectNodeId = genId();
		const initialInputParamId = genId();
		const initialOutputId = genId();
		const initialNodesEffect: ProjectNodesEffect = {
			id: genId(),
			name: 'Nodes Effect 1',
			definition: {
				kind: 'modify', resolutionInputParameters: [initialInputParamId],
				customParameterDefs: {},
				customParameterValues: {},
				automationGraphs: [],
				outputDefs: { [initialOutputId]: {
					label: 'Output',
					dataType: { kind: 'color' },
				} },
				primaryOutput: initialOutputId,
				primaryInputParameter: initialInputParamId,
				paramDefs: { [initialInputParamId]: {
					nameForReference: 'my_input',
					dataType: { kind: 'color' },
					ui: { label: 'My Input', control: {} },
					defaultValue: [0, 0, 0, 0],
					canNode: true,
				} },
				nodes: [{
					id: initialEffectNodeId,
					type: 'effect',
					staticSettings: {},
					resolution: { mode: 'auto', scale: 1 },
					effectSource: { type: 'nativeEffect', id: 'fill' },
					params: {
						color: { inputSource: 'literal', value: [0, 1, 0, 1] },
					},
					isBypass: false,
				}],
				outputSources: { [initialOutputId]: { nodeId: initialEffectNodeId, outputPort: 'output' } },
			},
		};
		return projectSessions.open({
			gsVersion: _VERSION_,
			name: DEFAULT_PROJECT_NAME,
			description: '',
			author: '',
			nodesEffects: [initialNodesEffect],
			customShaderEffects: [],
			assets: [],
			generatedSpeech: [],
			timelineScenes: [{
				id: genId(),
				name: 'SN1',
				resolution: { mode: 'project' },
				layers: [{
					id: genId(),
					layerType: 'effect',
					transformTarget: 'image',
					isDisabled: false,
					isSolo: false,
					color: null,
					effectSource: { type: 'nodesEffectReference', id: initialNodesEffect.id },
					effectStaticSettings: {}, resolution: { mode: 'context', scale: 1 },
					effectParamValues: {},
					forceDisableMotionBlur: false,
					mask: null,
					layerMask: null,
					isIncludedInComposite: true,
					coordinateSpace: 'screen',
					compositingParamValues: deepClone({
						depth: createDefaultParameterBinding(timelineCompositingParamDefs.depth),
						clipToFrame: createDefaultParameterBinding(timelineCompositingParamDefs.clipToFrame),
						fitMode: createDefaultParameterBinding(timelineCompositingParamDefs.fitMode),
						blendMode: createDefaultParameterBinding(timelineCompositingParamDefs.blendMode),
						opacity: createDefaultParameterBinding(timelineCompositingParamDefs.opacity),
						position: createDefaultParameterBinding(timelineCompositingParamDefs.position),
						origin: createDefaultParameterBinding(timelineCompositingParamDefs.origin),
						scale: createDefaultParameterBinding(timelineCompositingParamDefs.scale),
						rotation: createDefaultParameterBinding(timelineCompositingParamDefs.rotation),
					}),
					automationGraphs: [],
					name: 'Nodes Effect',
					clips: [{
						id: genId(),
						...createTimelineClipTiming(0, 1000 * 10),
					}],
				}],
			}],
			timelineFps: DEFAULT_TIMELINE_FPS,
			automationGraphs: [],
			exportSettings: null,
			timelineMotionBlur: { ...DEFAULT_TIMELINE_MOTION_BLUR },
			resolution: { width: 1024, height: 1024 },
		});
	}
	
	async function newProjectFromImageOrVideo(file?: File) {
		return await projectSessions.open(async () => createMediaProject(await openMediaFile({ file }))) != null;
	}
	
	async function newProjectFromMediaPath(filePath: string, type: string) {
		return await projectSessions.open(async () => createMediaProject(await openMediaFileFromPath(filePath, type))) != null;
	}
	
	async function createMediaProject(result: OpenedMediaFile | null): Promise<Project | null> {
		if (result == null) return null;
	
		const asset = {
			id: genId(),
			name: result.name,
			width: result.width,
			height: result.height,
			fileDataType: result.type,
			fileData: result.fileData,
			isExternalReference: result.isExternalReference,
			sourceFilePath: result.sourceFilePath,
			thumbnailSequence: result.thumbnailSequence,
			hash: result.hash,
		} satisfies ProjectAsset;
	
		const isVideo = asset.fileDataType.startsWith('video/');
		const isTimedMedia = isVideo || asset.fileDataType.startsWith('audio/');
		const media = isTimedMedia ? await inspectTimelineClipMedia(asset) : null;
		if (media != null && media.durationMs < 1) {
			await ui.alert({ type: 'error', text: i18n.ts._Assets.MediaTooShort });
			return null;
		}
		if (media?.audioError != null) await ui.alert({ type: 'warning', title: asset.name, text: media.audioError });
		const mediaLayer = isTimedMedia ? createTimelineAssetLayer(asset, 0, media) : null;
		const videoFrameRate = isVideo ? await readVideoFrameRate(asset.fileData) : null;

		const initialEffectNodeId = genId();
		const initialInputParamId = genId();
		const initialOutputId = genId();
		const initialNodesEffect: ProjectNodesEffect | null = isTimedMedia ? null : {
			id: genId(),
			name: 'Nodes Effect 1',
			definition: {
				kind: 'modify', resolutionInputParameters: [initialInputParamId],
				customParameterDefs: {},
				customParameterValues: {},
				automationGraphs: [],
				outputDefs: { [initialOutputId]: {
					label: 'Output',
					dataType: { kind: 'color' },
				} },
				primaryOutput: initialOutputId,
				primaryInputParameter: initialInputParamId,
				paramDefs: { [initialInputParamId]: {
					nameForReference: 'my_input',
					dataType: { kind: 'color' },
					ui: { label: 'My Input', control: {} },
					defaultValue: [0, 0, 0, 0],
					canNode: true,
				} },
				nodes: [{
					id: initialEffectNodeId,
					type: 'effect',
					staticSettings: { image: asset.id },
					resolution: { mode: 'auto', scale: 1 },
					effectSource: { type: 'nativeEffect', id: 'image' },
					params: {
						fit: createDefaultParameterBinding(imageEffectDef.paramDefs.fit),
					},
					isBypass: false,
				}],
				outputSources: { [initialOutputId]: { nodeId: initialEffectNodeId, outputPort: 'output' } },
			},
		};
	
		return {
			gsVersion: _VERSION_,
			name: DEFAULT_PROJECT_NAME,
			description: '',
			author: '',
			nodesEffects: initialNodesEffect == null ? [] : [initialNodesEffect],
			customShaderEffects: [],
			assets: [asset],
			generatedSpeech: [],
			timelineScenes: [{
				id: genId(),
				name: 'SN1',
				resolution: { mode: 'project' },
				layers: mediaLayer != null ? [mediaLayer] : [{
					id: genId(),
					isDisabled: false,
					isSolo: false,
					color: null,
					layerType: 'effect',
					transformTarget: 'image',
					name: 'Nodes Effect',
					effectSource: { type: 'nodesEffectReference', id: initialNodesEffect!.id },
					effectStaticSettings: {},
					resolution: { mode: 'context', scale: 1 },
					effectParamValues: {},
					clips: [{ id: genId(), ...createTimelineClipTiming(0, 1000 * 10) }],
					forceDisableMotionBlur: false,
					mask: null,
					layerMask: null,
					isIncludedInComposite: true,
					coordinateSpace: 'screen',
					compositingParamValues: deepClone({
						depth: createDefaultParameterBinding(timelineCompositingParamDefs.depth),
						clipToFrame: createDefaultParameterBinding(timelineCompositingParamDefs.clipToFrame),
						fitMode: createDefaultParameterBinding(timelineCompositingParamDefs.fitMode),
						blendMode: createDefaultParameterBinding(timelineCompositingParamDefs.blendMode),
						opacity: createDefaultParameterBinding(timelineCompositingParamDefs.opacity),
						position: createDefaultParameterBinding(timelineCompositingParamDefs.position),
						origin: createDefaultParameterBinding(timelineCompositingParamDefs.origin),
						scale: createDefaultParameterBinding(timelineCompositingParamDefs.scale),
						rotation: createDefaultParameterBinding(timelineCompositingParamDefs.rotation),
					}),
					automationGraphs: [],
				}],
			}],
			timelineFps: videoFrameRate ?? DEFAULT_TIMELINE_FPS,
			automationGraphs: [],
			exportSettings: null,
			timelineMotionBlur: { ...DEFAULT_TIMELINE_MOTION_BLUR },
			resolution: { width: result.width || 1024, height: result.height || 1024 },
		};
	}
	
	return { openProject, openRecentProject: (id: string) => openProject(null, null, id), newProject, newProjectFromImageOrVideo, newProjectFromMediaPath };
}
