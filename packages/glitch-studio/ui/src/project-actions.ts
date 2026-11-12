import { createTimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import { createTimelineMediaClipTiming } from '@gs/subsystems_timeline_shared/media-timing.ts';
import { timelineAudioParamDefs } from '@gs/subsystems_timeline_shared/timeline-audio.ts';
import { visualModulePublicParameterId, visualModulePublicParameterName } from '@gs/subsystems_visual-module_shared/types.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { genId } from '@gs/shared/utility/id.ts';
import fillEffectDef from '@gs/subsystems_effect_shared/fx/fill/_def_.ts';
import imageEffectDef from '@gs/subsystems_effect_shared/fx/image/_def_.ts';
import videoEffectDef from '@gs/subsystems_effect_shared/fx/video/_def_.ts';
import audioWaveformEffectDef from '@gs/subsystems_effect_shared/fx/audioWaveform/_def_.ts';
import { DEFAULT_TIMELINE_FPS, DEFAULT_TIMELINE_MOTION_BLUR } from './project-defaults.ts';
import { DEFAULT_PROJECT_NAME, loadProjectFile } from './gsproj.ts';
import { recentProjects } from './recent-projects.ts';
import type { ProjectSessionManager } from './ProjectSessionManager.ts';
import { applicationActivity } from './application-activity.ts';
import { inspectTimelineClipMedia } from './utility/timeline-clip-media.ts';
import { readVideoFrameRate } from './utility/video-frame-rate.ts';
import type { ProjectAsset } from './Project.ts';
import type { ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';
import type { EffectNodeOf } from '@gs/subsystems_visual-module_shared/types.ts';
import type { Player } from '@gs/shared/types.ts';
import type { ProjectFileHandle } from './gsproj.ts';
import type { OpenedMediaFile } from './api.ts';
import { i18n } from '@/i18n.ts';
import * as ui from '@/ui.ts';
import { openMediaFile, openMediaFileFromPath } from '@/utility/open-media-file.ts';

/** ファイル選択・初期データ作成を行い、新しい編集セッションとして追加する。 */
export function createProjectActions(projectSessions: ProjectSessionManager) {
	async function openProject(file?: File | null, fileHandle?: ProjectFileHandle | null, recentProjectId?: string): Promise<boolean> {
		const sessionId = genId();
		const releaseActivity = applicationActivity.acquire();
		const waiting = ui.waiting({ text: i18n.ts._App.LoadingProjectFile });
		try {
			try {
				if (recentProjectId != null) {
					fileHandle = await recentProjects.resolve(recentProjectId, sessionId);
					if (fileHandle == null) return false;
				}
				const result = await loadProjectFile(file, fileHandle, sessionId);
				if (result == null) return false;
				const session = await projectSessions.open(result.project, result.name, result.handle ?? null, sessionId);
				if (session == null) return false;
				if (result.handle != null) await recentProjects.remember(result.handle, result.project.name);
				return true;
			} finally { waiting.done(); }
		} catch (error) {
			console.error(error);
			await ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
			return false;
		} finally {
			await window.desktop?.releaseProjectReservations?.(sessionId).catch(console.error);
			releaseActivity();
		}
	}

	async function newProject() {
		const initialEffectNodeId = genId();
		const initialInputParamId = visualModulePublicParameterId(genId());
		const initialOutputId = genId();
		const initialVisualModule: ProjectVisualModule = {
			id: genId(),
			name: 'VM1',
			customParameterDefs: [],
			customParameterValues: {},
			automationGraphs: [],
			outputDefs: [{
				id: initialOutputId,
				label: 'Output',
				name: 'output',
				dataType: { kind: 'color' },
			}],
			primaryOutputId: initialOutputId,
			primaryInputId: initialInputParamId,
			paramDefs: [{
				id: initialInputParamId,
				nameForReference: visualModulePublicParameterName('my_input'),
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
				staticSettings: {},
				resolution: { mode: 'auto', scale: 1 },
				effectId: 'fill',
				displayName: '',
				params: {
					color: { inputSource: 'literal', value: [0, 1, 0, 1] },
				},
				isBypass: false,
			} satisfies EffectNodeOf<typeof fillEffectDef>, {
				id: genId(),
				type: 'globalOut',
				inputs: {
					[initialOutputId]: {
						nodeId: initialEffectNodeId,
						outputPort: 'output',
					},
				},
			}],
		} satisfies ProjectVisualModule;
		return projectSessions.open({
			id: genId(),
			gsVersion: _VERSION_,
			name: DEFAULT_PROJECT_NAME,
			description: '',
			author: '',
			visualModules: [initialVisualModule],
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
					layerType: 'visualModule',
					transformTarget: 'image',
					isDisabled: false,
					isSolo: false,
					color: null,
					visualModuleId: initialVisualModule.id,
					visualModuleParamValues: {},
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
					name: 'Visual Module',
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
		return applicationActivity.run(async () => loadMediaProject(await openMediaFile({ file })));
	}
	
	async function newProjectFromMediaPath(filePath: string, type: string) {
		return applicationActivity.run(async () => loadMediaProject(await openMediaFileFromPath(filePath, type)));
	}
	
	async function loadMediaProject(result: OpenedMediaFile | null) {
		if (result == null) return false;
	
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
				return false;
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
		const initialInputParamId = visualModulePublicParameterId(genId());
		const initialOutputId = genId();
		const initialVisualModule: ProjectVisualModule = {
			id: genId(),
			name: 'VM1',
			customParameterDefs: [],
			customParameterValues: {},
			automationGraphs: [],
			outputDefs: [{
				id: initialOutputId,
				label: 'Output',
				name: 'output',
				dataType: { kind: 'color' },
			}],
			primaryOutputId: initialOutputId,
			primaryInputId: initialInputParamId,
			paramDefs: [{
				id: initialInputParamId,
				nameForReference: visualModulePublicParameterName('my_input'),
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
				staticSettings: { image: asset.id },
				resolution: { mode: 'auto', scale: 1 },
				effectId: 'image',
				displayName: '',
				params: {
					fit: deepClone(imageEffectDef.paramDefs.fit.defaultValue),
				},
				isBypass: false,
			} satisfies EffectNodeOf<typeof imageEffectDef> : result.type.startsWith('video/') ? {
				id: initialEffectNodeId,
				type: 'effect',
				staticSettings: { player: player!.id },
				resolution: { mode: 'auto', scale: 1 },
				effectId: 'video',
				displayName: '',
				params: {
					fit: deepClone(videoEffectDef.paramDefs.fit.defaultValue),
				},
				isBypass: false,
			} satisfies EffectNodeOf<typeof videoEffectDef> : result.type.startsWith('audio/') ? {
				id: initialEffectNodeId,
				type: 'effect',
				staticSettings: {},
				resolution: { mode: 'auto', scale: 1 },
				effectId: 'audioWaveform',
				displayName: '',
				params: {
					audio: { inputSource: 'literal', value: { type: 'player', playerId: player!.id } },
					channel: deepClone(audioWaveformEffectDef.paramDefs.channel.defaultValue),
					duration: deepClone(audioWaveformEffectDef.paramDefs.duration.defaultValue),
					amplitude: deepClone(audioWaveformEffectDef.paramDefs.amplitude.defaultValue),
					lineWidth: deepClone(audioWaveformEffectDef.paramDefs.lineWidth.defaultValue),
					color: deepClone(audioWaveformEffectDef.paramDefs.color.defaultValue),
				},
				isBypass: false,
			} satisfies EffectNodeOf<typeof audioWaveformEffectDef> : {
				id: initialEffectNodeId,
				type: 'effect',
				staticSettings: {},
				resolution: { mode: 'auto', scale: 1 },
				effectId: 'fill',
				displayName: '',
				params: {
					color: { inputSource: 'literal', value: [0, 1, 0, 1] },
				},
				isBypass: false,
			} satisfies EffectNodeOf<typeof fillEffectDef>, {
				id: genId(),
				type: 'globalOut',
				inputs: {
					[initialOutputId]: {
						nodeId: initialEffectNodeId,
						outputPort: 'output',
					},
				},
			}],
		} satisfies ProjectVisualModule;
	
		const session = await projectSessions.open({
			id: genId(),
			gsVersion: _VERSION_,
			name: DEFAULT_PROJECT_NAME,
			description: '',
			author: '',
			visualModules: [initialVisualModule],
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
						layerType: 'visualModule' as const,
						transformTarget: 'image' as const,
						name: 'Visual Module',
						visualModuleId: initialVisualModule.id,
						visualModuleParamValues: {},
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
		});
	
		return session != null;
	}
	
	return { openProject, openRecentProject: (id: string) => openProject(null, null, id), newProject, newProjectFromImageOrVideo, newProjectFromMediaPath };
}
