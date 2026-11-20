import { createTimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import { createTimelineMediaClipTiming } from '@gs/subsystems_timeline_shared/media-timing.ts';
import { timelineAudioParamDefs } from '@gs/subsystems_timeline_shared/timeline-audio.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { genId } from '@gs/shared/utility/id.ts';
import imageEffectDef from '@gs/subsystems_effect-new_native-effects/fx/image/_def_.ts';
import videoEffectDef from '@gs/subsystems_effect-new_native-effects/fx/video/_def_.ts';
import audioWaveformEffectDef from '@gs/subsystems_effect-new_native-effects/fx/audioWaveform/_def_.ts';
import { DEFAULT_TIMELINE_FPS, DEFAULT_TIMELINE_MOTION_BLUR } from './project-defaults.ts';
import { DEFAULT_PROJECT_NAME, selectProjectFile } from './gsproj.ts';
import { recentProjects } from './recent-projects.ts';
import type { ProjectSessionManager } from './ProjectSessionManager.ts';
import { inspectTimelineClipMedia } from './utility/timeline-clip-media.ts';
import { readVideoFrameRate } from './utility/video-frame-rate.ts';
import type { ProjectAsset } from './Project.ts';
import type { ProjectCustomNodeGraphEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { Player } from '@gs/shared/types.ts';
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
		const initialCustomNodeGraphEffect: ProjectCustomNodeGraphEffect = {
			id: genId(),
			name: 'Custom Node Graph Effect 1',
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
					defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
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
			customNodeGraphEffects: [initialCustomNodeGraphEffect],
			customShaderEffects: [],
			assets: [],
			players: [],
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
					effectSource: { type: 'customNodeGraphEffectReference', id: initialCustomNodeGraphEffect.id },
					effectStaticSettings: {}, resolution: { mode: 'context', scale: 1 },
					effectParamValues: {},
					forceDisableMotionBlur: false,
					mask: null,
					layerMask: null,
					isIncludedInComposite: true,
					coordinateSpace: 'screen',
					compositingParamValues: deepClone({
						depth: timelineCompositingParamDefs.depth.defaultValue,
						clipToFrame: timelineCompositingParamDefs.clipToFrame.defaultValue,
						fitMode: timelineCompositingParamDefs.fitMode.defaultValue,
						blendMode: timelineCompositingParamDefs.blendMode.defaultValue,
						opacity: timelineCompositingParamDefs.opacity.defaultValue,
						position: timelineCompositingParamDefs.position.defaultValue,
						origin: timelineCompositingParamDefs.origin.defaultValue,
						scale: timelineCompositingParamDefs.scale.defaultValue,
						rotation: timelineCompositingParamDefs.rotation.defaultValue,
					}),
					automationGraphs: [],
					name: 'Custom Node Graph Effect',
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
	
		const videoMedia = result.type.startsWith('video/') ? await inspectTimelineClipMedia(asset) : null;
		const videoFrameRate = videoMedia != null ? await readVideoFrameRate(asset.fileData) : null;
		if (videoMedia != null) {
			if (videoMedia.durationMs < 1) {
				await ui.alert({ type: 'error', text: i18n.ts._Assets.MediaTooShort });
				return null;
			}
			if (videoMedia.audioError != null) {
				await ui.alert({ type: 'warning', title: asset.name, text: videoMedia.audioError });
			}
		}
	
		const player = result.type.startsWith('video/') || result.type.startsWith('audio/') ? {
			id: genId(),
			name: result.name,
			sourceType: 'asset',
			assetId: asset.id,
		} satisfies Player : null;
	
		const initialEffectNodeId = genId();
		const initialInputParamId = genId();
		const initialOutputId = genId();
		const initialCustomNodeGraphEffect: ProjectCustomNodeGraphEffect = {
			id: genId(),
			name: 'Custom Node Graph Effect 1',
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
					defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
					canNode: true,
				} },
				nodes: [result.type.startsWith('image/') ? {
					id: initialEffectNodeId,
					type: 'effect',
					staticSettings: { image: asset.id },
					resolution: { mode: 'auto', scale: 1 },
					effectSource: { type: 'nativeEffect', id: 'image' },
					params: {
						fit: deepClone(imageEffectDef.paramDefs.fit.defaultValue),
					},
					isBypass: false,
				} : result.type.startsWith('video/') ? {
					id: initialEffectNodeId,
					type: 'effect',
					staticSettings: { player: player!.id },
					resolution: { mode: 'auto', scale: 1 },
					effectSource: { type: 'nativeEffect', id: 'video' },
					params: {
						fit: deepClone(videoEffectDef.paramDefs.fit.defaultValue),
					},
					isBypass: false,
				} : result.type.startsWith('audio/') ? {
					id: initialEffectNodeId,
					type: 'effect',
					staticSettings: {},
					resolution: { mode: 'auto', scale: 1 },
					effectSource: { type: 'nativeEffect', id: 'audioWaveform' },
					params: {
						audio: { inputSource: 'literal', value: { type: 'player', playerId: player!.id } },
						channel: deepClone(audioWaveformEffectDef.paramDefs.channel.defaultValue),
						duration: deepClone(audioWaveformEffectDef.paramDefs.duration.defaultValue),
						amplitude: deepClone(audioWaveformEffectDef.paramDefs.amplitude.defaultValue),
						lineWidth: deepClone(audioWaveformEffectDef.paramDefs.lineWidth.defaultValue),
						color: deepClone(audioWaveformEffectDef.paramDefs.color.defaultValue),
					},
					isBypass: false,
				} : {
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
	
		return {
			gsVersion: _VERSION_,
			name: DEFAULT_PROJECT_NAME,
			description: '',
			author: '',
			customNodeGraphEffects: [initialCustomNodeGraphEffect],
			customShaderEffects: [],
			assets: [asset],
			players: player != null ? [player] : [],
			generatedSpeech: [],
			timelineScenes: [{
				id: genId(),
				name: 'SN1',
				resolution: { mode: 'project' },
				layers: [{
					id: genId(),
					isDisabled: false,
					isSolo: false,
					color: null,
					...(videoMedia != null ? {
						layerType: 'video' as const,
						name: asset.name,
						clips: [{
							id: genId(),
							...createTimelineMediaClipTiming(0, videoMedia.durationMs),
							assetId: asset.id,
							audioEnabled: videoMedia.audioAvailable,
							videoEnabled: true,
						}],
						audioParamValues: { volume: deepClone(timelineAudioParamDefs.volume.defaultValue) },
					} : {
						layerType: 'effect' as const,
						transformTarget: 'image' as const,
						name: 'Custom Node Graph Effect',
					effectSource: { type: 'customNodeGraphEffectReference', id: initialCustomNodeGraphEffect.id },
					effectStaticSettings: {}, resolution: { mode: 'context', scale: 1 },
						effectParamValues: {},
						clips: [{
							id: genId(),
							...createTimelineClipTiming(0, 1000 * 10),
						}],
					}),
					forceDisableMotionBlur: false,
					mask: null,
					layerMask: null,
					isIncludedInComposite: true,
					coordinateSpace: 'screen',
					compositingParamValues: deepClone({
						depth: timelineCompositingParamDefs.depth.defaultValue,
						clipToFrame: timelineCompositingParamDefs.clipToFrame.defaultValue,
						fitMode: timelineCompositingParamDefs.fitMode.defaultValue,
						blendMode: timelineCompositingParamDefs.blendMode.defaultValue,
						opacity: timelineCompositingParamDefs.opacity.defaultValue,
						position: timelineCompositingParamDefs.position.defaultValue,
						origin: timelineCompositingParamDefs.origin.defaultValue,
						scale: timelineCompositingParamDefs.scale.defaultValue,
						rotation: timelineCompositingParamDefs.rotation.defaultValue,
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
