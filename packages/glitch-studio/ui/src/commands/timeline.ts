import { validateStaticSettingValue } from '@gs/shared/static-setting.ts';
import { getTimelineLayerStaticSettings } from '@gs/subsystems_timeline_shared/layer-static-settings.ts';
import { convertTimelineContainerLayer } from '@gs/subsystems_timeline_shared/container-layer.ts';
import { isTimelineContainerLayer, isTimelineVisualLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { flattenTimelineLayers, findTimelineLayer, findTimelineLayerLocation, getTimelineClipLayers, updateTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { validateVoicevoxLayer } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import { resolveParameter } from '@gs/shared/parameter/parameter-path.ts';
import { validateTimelineEffectLayer } from '@gs/subsystems_timeline_shared/layers/effect/effect-layer.ts';
import { validateEffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import { canReferenceScene, validateTimelineLayer } from '@gs/subsystems_timeline_shared/scenes.ts';
import { getTimelineClipTrimBounds, getTimelineClipInsertionDuration, validateTimelineClips } from '@gs/subsystems_timeline_shared/timing.ts';
import { changeTimelineMediaPlaybackRate, createTimelineMediaClipTiming, getTimelineMediaLoopBounds, getTimelineMediaSingleDuration, getTimelineMediaTrimBounds, trimTimelineMediaClip, validateTimelineMediaClipTiming } from '@gs/subsystems_timeline_shared/media-timing.ts';
import { getTimelineVideoHoldTrimBounds, trimTimelineVideoHold, validateTimelineVideoHoldTiming } from '@gs/subsystems_timeline_shared/layers/video/video-hold.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { validateSceneResolution } from '@gs/subsystems_timeline_shared/scene-resolution.ts';
import { validateTimelineMask, validateTimelineLayerMask, isTimelineLayerTransformTarget } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { getTimelineLayerMaskSources } from '@gs/subsystems_timeline_shared/layer-output.ts';
import { getEffectDefinitions } from '../utility/project-effects.ts';
import { getScene, getLayerParameterTargets, getLayerParameterDefinitions, getLayerParameterValues } from '../utility/timeline-scene.ts';
import { prepareTimelineContainerMove } from '../utility/timeline-container.ts';
import { setTimelineLayerParameterRoot } from '../utility/timeline-parameter-edit.ts';
import { defineTimelineCommand } from './timeline-preparation.ts';
import { withCommandContract } from './definition.ts';
import { TIMELINE_COMMAND_CONTRACTS } from './timeline-command-contracts.ts';
import type { TimelineLayerCoordinateSpace, TimelineLayerTransformTarget, TimelineMask, TimelineLayerMask } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import type { TimelineAssetPlacement } from '../utility/timeline-asset-layer.ts';
import type { TimelineVideoHoldTiming } from '@gs/subsystems_timeline_shared/layers/video/video-hold.ts';
import type { TimelineSceneResolution } from '@gs/subsystems_timeline_shared/scene-resolution.ts';
import type { TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineClip, TimelineAssetClip, TimelineVideoClip, TimelineSceneClip } from '@gs/subsystems_timeline_shared/clip.ts';
import type { TimelineMediaClipTiming } from '@gs/subsystems_timeline_shared/media-timing.ts';
import type { TimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import type { EffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import type { VoicevoxSettings, VoicevoxUtterance } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import type { AppStateChange, ProjectState } from '../Project.ts';
import type { EditableTimelineParameterBinding } from '../types/parameter-edit.ts';
import type { TimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineContainerLayerType } from '@gs/subsystems_timeline_shared/container-layer.ts';
import type { TimelineKeyframeSelection, TimelineKeyframePosition } from '@/utility/timeline-selection.ts';
import type { TimelineClipPaste } from '@/utility/timeline-clip-clipboard.ts';
import type { TimelineClipSourceDurations } from '@/utility/timeline-clip-media.ts';
import type { TimelineKeyframePaste } from '@/utility/timeline-keyframe-clipboard.ts';
import { getTimelineKeyframePasteUpdates } from '@/utility/timeline-keyframe-clipboard.ts';
import { moveTimelineKeyframesInDraft } from '@/utility/timeline-keyframe-move.ts';
import { prepareTimelineClipMove } from '@/utility/timeline-clip-move.ts';

export const setTimelineGroupCompositingModeCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; mode: 'flat' | 'preserveDepth' }>({
	label: 'Change group compositing mode',
	changes: (_state, payload) => [{
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: payload.layerId,
		changes: [{ type: 'parameter', target: 'compositing', kind: 'value' }],
	}],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		const layer = getTimelineLayer(state, payload.sceneId, payload.layerId);
		if (layer.layerType !== 'group') throw new Error('Group not found');
		if (payload.mode !== 'flat' && payload.mode !== 'preserveDepth') throw new Error('Invalid compositing mode');
		layer.compositingMode = payload.mode;
	},
});

export const setTimelineLayerStaticSettingCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; key: string; value: string | number | boolean | null }>({
	label: 'Change timeline static setting',
	changes: (_state, payload) => [{ type: 'layer', sceneId: payload.sceneId, layerId: payload.layerId, changes: [{ type: 'staticSetting' }] }],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		const layer = getTimelineLayer(state, payload.sceneId, payload.layerId);
		const { definitions, values } = getTimelineLayerStaticSettings(layer, layer.layerType === 'effect' ? getEffectDefinitions(state).describe(layer.effectSource) : null);
		const definition = definitions[payload.key];
		if (definition == null) throw new Error('Static setting not found');
		validateStaticSettingValue(definition, payload.value);

		values[payload.key] = payload.value;
	},
});

export type TimelineClipData = TimelineClip | TimelineAssetClip | TimelineVideoClip | TimelineSceneClip;

export type TimelineClipTarget = { layerId: string; clipId: string };

export function getTimelineLayer(state: ProjectState, sceneId: string, layerId: string): TimelineLayer {
	const layer = findTimelineLayer(getScene(state, sceneId).layers, layerId);
	if (!layer) throw new Error('Timeline layer not found');
	return layer;
}

export function getTimelineClipLayer(state: ProjectState, sceneId: string, layerId: string) {
	const layer = getTimelineLayer(state, sceneId, layerId);
	if (isTimelineContainerLayer(layer)) throw new Error('Container has no clips');
	return layer;
}

export function getTimelineClip(state: ProjectState, sceneId: string, target: TimelineClipTarget) {
	const layer = getTimelineClipLayer(state, sceneId, target.layerId);
	const clip = layer.clips.find(clip => clip.id === target.clipId);
	if (!clip) throw new Error('Timeline clip not found');
	return { layer, clip };
}

// 省略可能プロパティや検索結果を直接受け取る境界なので、入力のundefinedも未指定として受け入れる。
export function requireMediaDurationMs(sourceDurationMs: number | null | undefined): number {
	if (sourceDurationMs == null || !Number.isFinite(sourceDurationMs) || sourceDurationMs <= 0) throw new Error('Invalid media duration');
	return sourceDurationMs;
}

// 省略可能プロパティや検索結果を直接受け取る境界なので、入力のundefinedも未指定として受け入れる。
export function validateMediaClipTiming(clip: TimelineClipData, sourceDurationMs: number | null | undefined) {
	if ('sourceTimeMs' in clip) {
		validateTimelineVideoHoldTiming(clip, requireMediaDurationMs(sourceDurationMs));
		return;
	}
	if (!('sourceInMs' in clip)) throw new Error('Invalid media clip');
	validateTimelineMediaClipTiming(clip, requireMediaDurationMs(sourceDurationMs));
}

/** 異なる素材種類の混入をコマンド境界で拒否してから、型別のclips配列へ保存する。 */
export function validateLayerClips(state: ProjectState, sceneId: string, layer: TimelineLayer, clips: readonly TimelineClipData[], sourceDurationsMs?: TimelineClipSourceDurations | null) {
	validateTimelineClips(clips);
	for (const clip of clips) {
		if (layer.layerType === 'video' && 'sourceTimeMs' in clip) {
			validateTimelineVideoHoldTiming(clip);
			if (!('audioEnabled' in clip) || clip.audioEnabled !== false) throw new Error('Video hold must be silent');
			if (!('videoEnabled' in clip) || clip.videoEnabled !== true) throw new Error('Video hold must have video enabled');
		} else if (layer.layerType === 'video' || layer.layerType === 'audio') {
			if (!('sourceInMs' in clip)) throw new Error('Invalid media clip');
			validateTimelineMediaClipTiming(clip);
		} else if (!('contentOffsetMs' in clip) || !Number.isFinite(clip.contentOffsetMs) || clip.contentOffsetMs < 0) throw new Error('Invalid content offset');
		if (layer.layerType === 'image' || layer.layerType === 'video' || layer.layerType === 'audio') {
			if (!('assetId' in clip) || typeof clip.assetId !== 'string'
				|| !state.assets.value.some(asset => asset.id === clip.assetId && asset.fileDataType.startsWith(layer.layerType + '/'))) throw new Error('Asset type does not match the layer');
			if (layer.layerType === 'video') {
				if (!('audioEnabled' in clip) || typeof clip.audioEnabled !== 'boolean') throw new Error('Invalid video clip');
				if (!('videoEnabled' in clip) || typeof clip.videoEnabled !== 'boolean') throw new Error('Invalid video clip');
			}
			if (sourceDurationsMs && layer.layerType !== 'image') validateMediaClipTiming(clip, sourceDurationsMs[layer.id]?.[clip.id]);
		} else if (layer.layerType === 'scene') {
			if (!('sceneId' in clip) || typeof clip.sceneId !== 'string' || !canReferenceScene(state.timelineScenes.value, sceneId, clip.sceneId)) throw new Error('Invalid or circular scene reference');
		}
	}
}

/** 子の一部だけが追加されることのないよう、グループ全体を変更前に検証する。 */
export function validateAddedTimelineLayer(state: ProjectState, sceneId: string, layer: TimelineLayer, sourceDurationsMs?: TimelineClipSourceDurations | null) {
	const ids = new Set(flattenTimelineLayers(getScene(state, sceneId).layers).map(entry => entry.id));
	for (const entry of flattenTimelineLayers([layer])) {
		if (ids.has(entry.id)) throw new Error('Duplicate layer ID');
		ids.add(entry.id);
	}
	validateTimelineLayer(layer);
	for (const child of getTimelineClipLayers([layer])) {
		if (child.layerType === 'effect') validateTimelineEffectLayer(child, getEffectDefinitions(state));
		if ((child.layerType === 'video' || child.layerType === 'audio') && child.clips.length > 0 && !sourceDurationsMs) throw new Error('Media duration is required');
		validateLayerClips(state, sceneId, child, child.clips, sourceDurationsMs);
	}
}

export const addTimelineLayerCommandDef = defineTimelineCommand<{ sceneId: string; layer: TimelineLayer; sourceDurationsMs?: TimelineClipSourceDurations | null }>({
	label: 'Add timeline layer',
	// 単一レイヤーのルート追加では既存の兄弟を送り直さず、子孫を伴う追加だけ階層全体を通知する。
	changes: (_state, payload) => isTimelineContainerLayer(payload.layer) ? [{ type: 'layerTree', sceneId: payload.sceneId }]
	: [{
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: payload.layer.id,
		changes: [{ type: 'definition' }],
	}, { type: 'layerOrder', sceneId: payload.sceneId }],
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		const scene = getScene(state, payload.sceneId);
		validateAddedTimelineLayer(state, payload.sceneId, payload.layer, payload.sourceDurationsMs);
		scene.layers.unshift(deepClone(payload.layer));
	},
});

export function getTimelineAssetPlacementChanges(placement: TimelineAssetPlacement | null): AppStateChange[] {
	if (placement == null || placement.layers.length === 0) return [];
	if (placement.layers.some(layer => isTimelineContainerLayer(layer))) return [{ type: 'layerTree', sceneId: placement.sceneId }];
	return [
		...placement.layers.map(layer => ({
			type: 'layer' as const,
			sceneId: placement.sceneId,
			layerId: layer.id,
			changes: [{ type: 'definition' as const }],
		})),
		{ type: 'layerOrder', sceneId: placement.sceneId },
	];
}

export function validateTimelineAssetPlacement(state: ProjectState, placement: TimelineAssetPlacement) {
	getScene(state, placement.sceneId);
	const ids = new Set<string>();
	for (const layer of placement.layers) {
		if (ids.has(layer.id)) throw new Error('Duplicate layer ID');
		ids.add(layer.id);
		validateAddedTimelineLayer(state, placement.sceneId, layer, placement.sourceDurationsMs);
	}
}

export function removeTimelineAssetPlacement(state: ProjectState, placement: TimelineAssetPlacement) {
	const ids = new Set(placement.layers.map(layer => layer.id));
	const scene = getScene(state, placement.sceneId);
	scene.layers = scene.layers.filter(layer => !ids.has(layer.id));
}

export const addTimelineAssetLayersCommandDef = defineTimelineCommand<TimelineAssetPlacement>({
	label: 'Add timeline asset layers',
	changes: (_state, payload) => getTimelineAssetPlacementChanges(payload),
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		validateTimelineAssetPlacement(state, payload);
		getScene(state, payload.sceneId).layers.unshift(...deepClone(payload.layers));
	},
});

export const setTimelineLayerNameCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; name: string }>({
	label: 'Rename timeline layer',
	changes: (_state, payload) => [{ type: 'layerName', sceneId: payload.sceneId, layerId: payload.layerId }],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		if (typeof payload.name !== 'string') throw new Error('Layer name must be a string');
		const layer = getTimelineLayer(state, payload.sceneId, payload.layerId);
		layer.name = payload.name;
	},
});

export const setTimelineLayerColorCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; color: TimelineLayer['color'] }>({
	label: 'Change timeline layer color',
	changes: (_state, payload) => [{ type: 'layerColor', sceneId: payload.sceneId, layerId: payload.layerId }],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		// レイヤーの識別色はUI用のRGBAで、作品のHDR色とは異なり各成分0〜1に限る。
		if (payload.color != null && (!Array.isArray(payload.color) || payload.color.length !== 4
			|| !payload.color.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1))) {
			throw new Error('Layer color must be null or four components between 0 and 1');
		}
		const layer = getTimelineLayer(state, payload.sceneId, payload.layerId);

		layer.color = payload.color == null ? null : deepClone(payload.color);
	},
});

export const setTimelineLayerDisabledCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; isDisabled: boolean }>({
	label: 'Change timeline layer visibility',
	changes: (_state, payload) => [{
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: payload.layerId,
		changes: [{ type: 'disabled' }],
	}],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		if (typeof payload.isDisabled !== 'boolean') throw new Error('Layer disabled state must be a boolean');
		const layer = getTimelineLayer(state, payload.sceneId, payload.layerId);

		layer.isDisabled = payload.isDisabled;
	},
});

export const setTimelineLayerSoloCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; isSolo: boolean }>({
	label: 'Change timeline layer solo',
	changes: (_state, payload) => [{ type: 'layer', sceneId: payload.sceneId, layerId: payload.layerId, changes: [{ type: 'solo' }] }],
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		if (typeof payload.isSolo !== 'boolean') throw new Error('Layer solo state must be a boolean');
		const layer = getTimelineLayer(state, payload.sceneId, payload.layerId);
		if (layer.layerType === 'camera') throw new Error('Camera layers cannot be soloed');

		layer.isSolo = payload.isSolo;
	},
});

export const clearTimelineSoloCommandDef = defineTimelineCommand<{ sceneId: string }>({
	label: 'Clear timeline solo',
	// 全解除後にも対象を通知でき、Undoでも同じ経路で階層内の設定を同期する。
	changes: (_state, payload) => [{ type: 'layerTree', sceneId: payload.sceneId }],
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		for (const layer of flattenTimelineLayers(getScene(state, payload.sceneId).layers)) layer.isSolo = false;
	},
});

export const setTimelineLayerCoordinateSpaceCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; coordinateSpace: TimelineLayerCoordinateSpace }>({
	label: 'Change timeline layer coordinate space',
	changes: (_state, payload) => [{
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: payload.layerId,
		changes: [{ type: 'coordinateSpace' }],
	}],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		if (!['world', 'screen'].includes(payload.coordinateSpace)) throw new Error('Invalid timeline layer coordinate space');
		const getLayer = (state: ProjectState) => {
			const layer = getTimelineLayer(state, payload.sceneId, payload.layerId);
			if (!isTimelineVisualLayer(layer)) throw new Error('Coordinate space requires a visual layer');
			return layer;
		};
		const layer = getLayer(state);

		layer.coordinateSpace = payload.coordinateSpace;
	},
});

export const setTimelineLayerTransformTargetCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; transformTarget: TimelineLayerTransformTarget }>({
	label: 'Change timeline layer transform target',
	changes: (_state, payload) => [{
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: payload.layerId,
		changes: [{ type: 'transformTarget' }],
	}],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		const getLayer = (state: ProjectState) => {
			const layer = getTimelineLayer(state, payload.sceneId, payload.layerId);
			if (layer.layerType !== 'effect') throw new Error('Transform target requires an effect or Custom Node Graph Effect layer');
			return layer;
		};
		if (!isTimelineLayerTransformTarget(payload.transformTarget)) throw new Error('Invalid timeline layer transform target');
		const layer = getLayer(state);

		layer.transformTarget = payload.transformTarget;
	},
});

export const setTimelineLayerMaskCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; mask: TimelineMask | null }>({
	label: 'Change timeline layer mask',
	changes: (_state, payload) => [{
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: payload.layerId,
		changes: [{ type: 'mask' }],
	}],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		const getLayer = (state: ProjectState) => {
			const layer = getTimelineLayer(state, payload.sceneId, payload.layerId);
			if (!isTimelineVisualLayer(layer)) throw new Error('Mask requires a visual layer');
			return layer;
		};
		validateTimelineMask(payload.mask);
		const layer = getLayer(state);

		layer.mask = deepClone(payload.mask);
	},
});

export const setTimelineLayerReferenceMaskCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; layerMask: TimelineLayerMask | null }>({
	label: 'Change timeline layer reference mask',
	changes: (_state, payload) => [{
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: payload.layerId,
		changes: [{ type: 'layerMask' }],
	}],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		const getLayer = (state: ProjectState) => {
			const layer = getTimelineLayer(state, payload.sceneId, payload.layerId);
			if (!isTimelineVisualLayer(layer)) throw new Error('Layer mask requires a visual layer');
			return layer;
		};
		validateTimelineLayerMask(payload.layerMask);
		const layer = getLayer(state);
		const layerMask = payload.layerMask;
		const layers = getScene(state, payload.sceneId).layers;
		if (layerMask != null && findTimelineLayer(layers, layerMask.sourceLayerId) != null
			&& !getTimelineLayerMaskSources(layers, layer.id).some(source => source.id === layerMask.sourceLayerId)) throw new Error('Layer mask source must be another visual layer in the same compositing boundary');

		layer.layerMask = deepClone(payload.layerMask);
	},
});

export const setTimelineLayerCompositeInclusionCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; isIncludedInComposite: boolean }>({
	label: 'Change timeline layer composite inclusion',
	changes: (_state, payload) => [{
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: payload.layerId,
		changes: [{ type: 'compositeInclusion' }],
	}],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		const getLayer = (state: ProjectState) => {
			const layer = getTimelineLayer(state, payload.sceneId, payload.layerId);
			if (!isTimelineVisualLayer(layer)) throw new Error('Composite inclusion requires a visual layer');
			return layer;
		};
		if (typeof payload.isIncludedInComposite !== 'boolean') throw new Error('Invalid timeline composite inclusion');
		const layer = getLayer(state);

		layer.isIncludedInComposite = payload.isIncludedInComposite;
	},
});

export const setTimelineLayerMotionBlurDisabledCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; forceDisableMotionBlur: boolean }>({
	label: 'Change timeline layer motion blur',
	changes: (_state, payload) => [{
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: payload.layerId,
		changes: [{ type: 'motionBlur' }],
	}],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		if (typeof payload.forceDisableMotionBlur !== 'boolean') throw new Error('Layer motion blur disabled state must be a boolean');
		const getLayer = (state: ProjectState) => {
			const layer = getTimelineLayer(state, payload.sceneId, payload.layerId);
			if (!('forceDisableMotionBlur' in layer)) throw new Error('Motion blur requires a visual layer');
			return layer;
		};
		const layer = getLayer(state);

		layer.forceDisableMotionBlur = payload.forceDisableMotionBlur;
	},
});

export const setTimelineEffectLayerResolutionCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; resolution: EffectResolution }>({
	label: 'Change effect layer resolution',
	changes: (_state, payload) => [{
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: payload.layerId,
		changes: [{ type: 'resolution' }],
	}],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		const getLayer = (state: ProjectState) => {
			const layer = getTimelineLayer(state, payload.sceneId, payload.layerId);
			if (layer.layerType !== 'effect') throw new Error('Effect layer not found');
			return layer;
		};
		validateEffectResolution(payload.resolution);
		const layer = getLayer(state);

		layer.resolution = deepClone(payload.resolution);
	},
});

export const addTimelineClipCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; clip: TimelineClipData; sourceDurationMs?: number | null }>({
	label: 'Add timeline clip',
	changes: (_state, payload) => [{
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: payload.layerId,
		changes: [{ type: 'clips' }],
	}],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		const layer = getTimelineClipLayer(state, payload.sceneId, payload.layerId);
		const clips = [...layer.clips, deepClone(payload.clip)];
		validateTimelineClips(clips);
		validateLayerClips(state, payload.sceneId, layer, [payload.clip]);
		if (layer.layerType === 'video' || layer.layerType === 'audio') validateMediaClipTiming(payload.clip, payload.sourceDurationMs);
		// validateLayerClipsが保存先の種類と素材の対応を検証済み。キーや設定は変更しない。
		Object.assign(layer, { clips });
	},
});

export const insertTimelineClipsCommandDef = defineTimelineCommand<{ sceneId: string; clips: TimelineClipPaste[]; sourceDurationsMs?: TimelineClipSourceDurations | null }>({
	label: 'Paste timeline clips',
	changes: (_state, payload) => [...new Set(payload.clips.map(entry => entry.layerId))]
		.map(layerId => ({
			type: 'layer',
			sceneId: payload.sceneId,
			layerId,
			changes: [{ type: 'clips' }],
		})),
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		if (payload.clips.length === 0) throw new Error('No clips to paste');
		const proposed = [...new Set(payload.clips.map(entry => entry.layerId))].map(layerId => {
			const layer = getTimelineClipLayer(state, payload.sceneId, layerId);
			const added = payload.clips.filter(entry => entry.layerId === layerId).map(entry => entry.clip);
			const clips = [...layer.clips, ...deepClone(added)];
			validateTimelineClips(clips);
			validateLayerClips(state, payload.sceneId, layer, added);
			if (layer.layerType === 'video' || layer.layerType === 'audio') {
				for (const clip of added) validateMediaClipTiming(clip, payload.sourceDurationsMs?.[layer.id]?.[clip.id]);
			}
			return { layer, clips };
		});
			// 全レイヤーの検証が済むまで変更しない。一部だけ貼り付けられる状態を防ぐ。
		for (const { layer, clips } of proposed) Object.assign(layer, { clips });
	},
});

export const trimTimelineClipCommandDef = defineTimelineCommand<TimelineClipTarget & { sceneId: string; edge: 'start' | 'end'; deltaMs: number; sourceDurationMs?: number | null }>({
	label: 'Trim timeline clip',
	changes: (_state, payload) => [{
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: payload.layerId,
		changes: [{ type: 'clips' }],
	}],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		const { layer, clip } = getTimelineClip(state, payload.sceneId, payload);

		if (!Number.isFinite(payload.deltaMs)) throw new Error('Invalid trim');
		const media = layer.layerType === 'audio' || layer.layerType === 'video';
		// Asset一覧で短い素材へ置き換えると、現在の区間は素材長を超え得る。
		// 変更前の長さでは拒否せず、素材長自体と、修復後の区間を別々に検証する。
		const sourceDurationMs = media ? requireMediaDurationMs(payload.sourceDurationMs) : null;
		// ドラッグの途中でポインターを戻す操作は、確定済みクリップの左延長とは別。
		// 開始時の区間から制限し、同じドラッグ内では開始状態まで戻れるようにする。
		const initial = deepClone(clip);
		const initialClips = layer.clips.map(entry => entry.id === clip.id ? initial : entry);
		validateTimelineClips(initialClips);
		const bounds = 'sourceTimeMs' in initial
			? getTimelineVideoHoldTrimBounds(initialClips, initial, payload.edge) : 'sourceInMs' in initial
				? getTimelineMediaTrimBounds(initialClips, initial, payload.edge, sourceDurationMs!)
				: getTimelineClipTrimBounds(initialClips, initial, payload.edge, layer.layerType === 'scene', sourceDurationMs ?? Infinity);
		if (bounds.minDelta > bounds.maxDelta) throw new Error('No valid clip duration within the media');
		if (!Number.isSafeInteger(payload.deltaMs) || payload.deltaMs < bounds.minDelta || payload.deltaMs > bounds.maxDelta) throw new Error('Timeline edit is outside the valid range');
		const delta = payload.deltaMs;

		let next: TimelineClipData;
		if ('sourceTimeMs' in initial) next = { ...clip, ...trimTimelineVideoHold(initial, payload.edge, delta) };
		else if ('sourceInMs' in initial) next = { ...clip, ...trimTimelineMediaClip(initial, payload.edge, delta) };
		else if (payload.edge === 'start') next = {
			...clip,
			startMs: initial.startMs + delta,
			durationMs: initial.durationMs - delta,
			contentOffsetMs: initial.contentOffsetMs + delta,
		};
		else next = { ...clip, durationMs: initial.durationMs + delta };
		validateTimelineClips(layer.clips.map(entry => entry.id === clip.id ? next : entry));
		if (media) validateMediaClipTiming(next, payload.sourceDurationMs);
		const after = next;
		Object.assign(clip, after);
	},
});

export const resizeTimelineMediaClipLoopCommandDef = defineTimelineCommand<TimelineClipTarget & { sceneId: string; deltaMs: number; sourceDurationMs: number }>({
	label: 'Resize media loop',
	changes: (_state, payload) => [{
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: payload.layerId,
		changes: [{ type: 'clips' }],
	}],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		const find = (state: ProjectState) => {
			const layer = getTimelineClipLayer(state, payload.sceneId, payload.layerId);
			if (layer.layerType !== 'video' && layer.layerType !== 'audio') throw new Error('Media layer not found');
			const clip = layer.clips.find(entry => entry.id === payload.clipId);
			if (clip == null || !('sourceInMs' in clip)) throw new Error('Media clip not found');
			return { layer, clip };
		};
		const { layer, clip } = find(state);

		if (!Number.isFinite(payload.deltaMs)) throw new Error('Invalid loop resize');
		const initial = deepClone(clip);
		const initialClips = layer.clips.map(entry => entry.id === clip.id ? initial : entry);
		validateTimelineClips(initialClips);
		validateMediaClipTiming(initial, payload.sourceDurationMs);
		const bounds = getTimelineMediaLoopBounds(initialClips, initial);
		if (!Number.isSafeInteger(payload.deltaMs) || payload.deltaMs < bounds.minDelta || payload.deltaMs > bounds.maxDelta) throw new Error('Timeline edit is outside the valid range');
		const delta = payload.deltaMs;
		const durationMs = initial.durationMs + delta;
		const next = { ...clip, durationMs, loop: durationMs > getTimelineMediaSingleDuration(initial) };
		validateTimelineClips(layer.clips.map(entry => entry.id === clip.id ? next : entry));
		validateMediaClipTiming(next, payload.sourceDurationMs);

		const after = { durationMs: next.durationMs, loop: next.loop };
		Object.assign(clip, after);
	},
});

export const setTimelineMediaClipPlaybackRateCommandDef = defineTimelineCommand<TimelineClipTarget & { sceneId: string; playbackRate: number; sourceDurationMs: number }>({
	label: 'Change media playback speed',
	changes: (_state, payload) => [{
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: payload.layerId,
		changes: [{ type: 'clips' }],
	}],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		const { layer, clip } = getTimelineClip(state, payload.sceneId, payload);
		if (!('sourceInMs' in clip)) throw new Error('Media clip not found');

		const next = changeTimelineMediaPlaybackRate(clip, payload.playbackRate);
		// 素材範囲も後続の配置も勝手に変更しない。衝突する倍率は全体を拒否する。
		validateTimelineClips(layer.clips.map(entry => entry.id === clip.id ? next : entry));
		validateMediaClipTiming(next, payload.sourceDurationMs);

		Object.assign(clip, next);
	},
});

export const moveTimelineClipsCommandDef = defineTimelineCommand<{ sceneId: string; clips: TimelineClipTarget[]; deltaMs: number }>({
	label: 'Move timeline clips',
	changes: (state, payload) => [...new Set(payload.clips.map(clip => clip.layerId))].map(layerId => ({
		type: 'layer',
		sceneId: payload.sceneId,
		layerId,
		changes: [
			{ type: 'clips' },
			...getLayerParameterTargets(getTimelineLayer(state, payload.sceneId, layerId)).map(target => ({ type: 'parameter' as const, target, kind: 'value' as const })),
			...(getTimelineLayer(state, payload.sceneId, layerId).layerType === 'voicevox' ? [{ type: 'definition' as const }] : []),
		],
	})),
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		if (!Number.isSafeInteger(payload.deltaMs)) throw new Error('Invalid clip move');
		if (payload.clips.length === 0) return;
		const scene = getScene(state, payload.sceneId);
		const move = prepareTimelineClipMove(state, scene, payload.clips);
		if (payload.deltaMs < move.minDelta || payload.deltaMs > move.maxDelta) throw new Error('Timeline edit is outside the valid range');
		moveTimelineKeyframesInDraft(state, scene, move.keyframes.map(point => ({ ...point, x: point.x + payload.deltaMs })));
		for (const target of move.clips) getTimelineClip(state, payload.sceneId, target).clip.startMs = target.startMs + payload.deltaMs;
	},
});

export const removeTimelineClipsCommandDef = defineTimelineCommand<{ sceneId: string; clips: TimelineClipTarget[] }>({
	label: 'Remove timeline clips',
	changes: (_state, payload) => payload.clips.map(clip => ({
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: clip.layerId,
		changes: [{ type: 'clips' }],
	})),
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		for (const target of payload.clips) getTimelineClip(state, payload.sceneId, target);
		const layers = [...new Set(payload.clips.map(target => target.layerId))].map(id => getTimelineClipLayer(state, payload.sceneId, id));

		// 空になってもレイヤー・キー・合成設定を残し、次の追加で再利用できるようにする。
		for (const layer of layers) Object.assign(layer, { clips: layer.clips.filter(clip => !payload.clips.some(target => target.layerId === layer.id && target.clipId === clip.id)) });
	},
});

export const setTimelineClipSourceCommandDef = defineTimelineCommand<TimelineClipTarget & { sceneId: string; assetId?: string; referencedSceneId?: string; sourceDurationMs?: number | null; audioEnabled?: boolean }>({
	label: 'Change timeline clip source',
	changes: (_state, payload) => [{
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: payload.layerId,
		changes: [{ type: 'clips' }],
	}],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		if (payload.audioEnabled != null && typeof payload.audioEnabled !== 'boolean') throw new Error('Clip audio enabled state must be a boolean');
		const { layer, clip } = getTimelineClip(state, payload.sceneId, payload);
		const media = layer.layerType === 'video' || layer.layerType === 'audio';
		if (media) requireMediaDurationMs(payload.sourceDurationMs);
		const next = {
			...(media ? { id: clip.id, startMs: clip.startMs, durationMs: clip.durationMs } : clip),
			...(media ? createTimelineMediaClipTiming(clip.startMs, getTimelineClipInsertionDuration(layer.clips.filter(entry => entry.id !== clip.id), clip.startMs, requireMediaDurationMs(payload.sourceDurationMs))) : { contentOffsetMs: 0 }),
			...(layer.layerType === 'scene' ? { sceneId: payload.referencedSceneId } : { assetId: payload.assetId }),
			...(layer.layerType === 'video' ? {
				audioEnabled: payload.audioEnabled ?? ('audioEnabled' in clip && clip.audioEnabled),
				videoEnabled: 'videoEnabled' in clip && clip.videoEnabled,
			} : {}),
		};
		if (layer.layerType !== 'scene' && layer.layerType !== 'image' && !media) throw new Error('Layer has no clip source');
		validateTimelineClips(layer.clips.map(entry => entry.id === clip.id ? next : entry));
		// 他のクリップが参照切れでも、選択した素材の修復を妨げない。
		validateLayerClips(state, payload.sceneId, layer, [next]);

		replaceTimelineClipData(clip, next);
	},
});

/** 時間モデルの切り替えでは、旧モデルのフィールドをUndo/Redoでも残さない。 */
export function replaceTimelineClipData(clip: TimelineClipData, next: TimelineClipData): void {
	for (const key of Object.keys(clip)) {
		if (!(key in next)) delete (clip as unknown as Record<string, unknown>)[key];
	}
	Object.assign(clip, next);
}

export const holdTimelineVideoClipFrameCommandDef = defineTimelineCommand<TimelineClipTarget & { sceneId: string; sourceTimeMs: number; sourceDurationMs: number }>({
	label: 'Hold video frame',
	changes: (_state, payload) => [{
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: payload.layerId,
		changes: [{ type: 'clips' }],
	}],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		const find = (state: ProjectState) => {
			const layer = getTimelineClipLayer(state, payload.sceneId, payload.layerId);
			if (layer.layerType !== 'video') throw new Error('Video layer not found');
			const clip = layer.clips.find(clip => clip.id === payload.clipId);
			if (clip == null) throw new Error('Video clip not found');
			return clip;
		};
		const clip = find(state);

		const next: TimelineVideoClip = {
			id: clip.id,
			assetId: clip.assetId,
			startMs: clip.startMs,
			durationMs: clip.durationMs,
			sourceTimeMs: payload.sourceTimeMs,
			audioEnabled: false,
			videoEnabled: true,
		};
		validateTimelineVideoHoldTiming(next, requireMediaDurationMs(payload.sourceDurationMs));

		replaceTimelineClipData(clip, next);
	},
});

export const setTimelineVideoClipVideoEnabledCommandDef = defineTimelineCommand<TimelineClipTarget & { sceneId: string; videoEnabled: boolean }>({
	label: 'Edit video clip video output',
	changes: (_state, payload) => [{
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: payload.layerId,
		changes: [{ type: 'clips' }],
	}],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		if (typeof payload.videoEnabled !== 'boolean') throw new Error('Clip video enabled state must be a boolean');
		const find = (state: ProjectState) => {
			const layer = getTimelineClipLayer(state, payload.sceneId, payload.layerId);
			if (layer.layerType !== 'video') throw new Error('Video layer not found');
			const clip = layer.clips.find(clip => clip.id === payload.clipId);
			if (clip == null) throw new Error('Video clip not found');
			return clip;
		};
		const clip = find(state);
		if ('sourceTimeMs' in clip && !payload.videoEnabled) throw new Error('Video hold must have video enabled');

		clip.videoEnabled = payload.videoEnabled;
	},
});

export const setTimelineVideoClipAudioEnabledCommandDef = defineTimelineCommand<TimelineClipTarget & { sceneId: string; audioEnabled: boolean }>({
	label: 'Edit video clip audio',
	changes: (_state, payload) => [{
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: payload.layerId,
		changes: [{ type: 'clips' }],
	}],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		if (typeof payload.audioEnabled !== 'boolean') throw new Error('Clip audio enabled state must be a boolean');
		const find = (state: ProjectState) => {
			const layer = getTimelineClipLayer(state, payload.sceneId, payload.layerId);
			if (layer.layerType !== 'video') throw new Error('Video layer not found');
			const clip = layer.clips.find(clip => clip.id === payload.clipId);
			if (!clip) throw new Error('Video clip not found');
			return clip;
		};
		const clip = find(state);
		if ('sourceTimeMs' in clip && payload.audioEnabled) throw new Error('Video hold must be silent');

		clip.audioEnabled = payload.audioEnabled;
	},
});

export const pasteTimelineLayerCommandDef = defineTimelineCommand<{ sceneId: string; layer: TimelineLayer; sourceLayerId: string; sourceDurationsMs?: TimelineClipSourceDurations | null }>({
	label: 'Paste timeline layer',
	changes: (_state, payload) => [{ type: 'layerTree', sceneId: payload.sceneId }],
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		validateAddedTimelineLayer(state, payload.sceneId, payload.layer, payload.sourceDurationsMs);
		const location = findTimelineLayerLocation(getScene(state, payload.sceneId).layers, payload.sourceLayerId);
		const siblings = location?.siblings ?? getScene(state, payload.sceneId).layers;
		// 表示順は先頭が最上層。コピー元が削除済みなら最上層へ挿入する。
		siblings.splice(location?.index ?? 0, 0, deepClone(payload.layer));
	},
});

export const reorderTimelineLayersCommandDef = defineTimelineCommand<{ sceneId: string; layerIds: string[] }>({
	label: 'Reorder timeline layers',
	changes: (_state, payload) => [{ type: 'layerOrder', sceneId: payload.sceneId }],
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		const reorder = (state: ProjectState, layerIds: string[]) => {
			const layers = new Map(getScene(state, payload.sceneId).layers.map(layer => [layer.id, layer]));
			if (layerIds.length !== layers.size || new Set(layerIds).size !== layers.size || layerIds.some(id => !layers.has(id))) {
				throw new Error('Invalid timeline layer order');
			}
			// D&Dで渡されるレイヤーのコピーではなく、現在のレイヤーをIDで並べ替える。
			getScene(state, payload.sceneId).layers = layerIds.map(id => layers.get(id)!);
		};

		reorder(state, payload.layerIds);
	},
});

export const removeTimelineLayerCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string }>({
	label: 'Remove timeline layer',
	changes: (_state, payload) => [{ type: 'layerTree', sceneId: payload.sceneId }],
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		const scene = getScene(state, payload.sceneId);
		getTimelineLayer(state, payload.sceneId, payload.layerId);

		scene.layers = updateTimelineLayer(scene.layers, payload.layerId, () => null);
	},
});

export const setTimelineSceneResolutionCommandDef = defineTimelineCommand<{ sceneId: string; resolution: TimelineSceneResolution }>({
	label: 'Change scene resolution',
	changes: (_state, payload) => [{ type: 'scene', sceneId: payload.sceneId }],
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		validateSceneResolution(payload.resolution);
		const scene = getScene(state, payload.sceneId);

		scene.resolution = deepClone(payload.resolution);
	},
});

export const setTimelineSceneNameCommandDef = defineTimelineCommand<{ sceneId: string; name: string }>({
	label: 'Rename scene',
	changes: (_state, payload) => [{ type: 'sceneName', sceneId: payload.sceneId }],
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		if (typeof payload.name !== 'string') throw new Error('Scene name must be a string');
		const scene = getScene(state, payload.sceneId);
		scene.name = payload.name;
	},
});

export const removeTimelineSceneCommandDef = defineTimelineCommand<{ sceneId: string }>({
	label: 'Remove scene',
	changes: (_state, payload) => [{ type: 'scene', sceneId: payload.sceneId }],
	scope: () => ({ scenes: true }),
	edit: (state, payload) => {
		const references = state.timelineScenes.value.filter(scene => flattenTimelineLayers(scene.layers).some(layer => layer.layerType === 'scene' && layer.clips.some(clip => clip.sceneId === payload.sceneId)));
		if (references.length > 0) throw new Error('Scene is used by: ' + references.map(scene => scene.name).join(', '));

		const index = state.timelineScenes.value.findIndex(scene => scene.id === payload.sceneId);
		if (index < 0) throw new Error('Timeline scene not found');
		state.timelineScenes.value.splice(index, 1);
	},
});

export const insertTimelineKeyframesCommandDef = defineTimelineCommand<{ sceneId: string; keyframes: TimelineKeyframePaste[] }>({
	label: 'Paste timeline keyframes',
	changes: (_state, payload) => [...new Map(payload.keyframes.map(entry => [JSON.stringify([entry.layerId, entry.target]),
																																																																											{
																																																																												type: 'layer' as const,
																																																																												sceneId: payload.sceneId,
																																																																												layerId: entry.layerId,
																																																																												changes: entry.target === 'utterance' ? [{ type: 'definition' as const }] : [{ type: 'parameter' as const, target: entry.target, kind: 'value' as const }],
																																																																											}])).values()],
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		const updates = getTimelineKeyframePasteUpdates(state, getScene(state, payload.sceneId), payload.keyframes);
		if (updates == null) throw new Error('Invalid or overlapping timeline keyframe paste');
		for (const update of updates) {
			const layer = getTimelineLayer(state, payload.sceneId, update.layerId);
			if (update.target === 'utterance') {
				if (layer.layerType === 'voicevox') layer.utterances = deepClone(update.after);
			} else setTimelineLayerParameterRoot(layer, update.target, update.paramId, update.after);
		}
	},
});

export const moveTimelineKeyframesCommandDef = defineTimelineCommand<{ sceneId: string; positions: TimelineKeyframePosition[] }>({
	label: 'Move timeline keyframes',
	changes: (_state, payload) => payload.positions.map(position => ({
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: position.layerId,
		changes: position.target === 'utterance' ? [{ type: 'definition' }] : [{ type: 'parameter', target: position.target, kind: 'value' }],
	})),
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		moveTimelineKeyframesInDraft(state, getScene(state, payload.sceneId), payload.positions);
	},
});

export const replaceTimelineVoicevoxContentCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; voicevox: VoicevoxSettings; utterances: VoicevoxUtterance[] }>({
	label: 'Edit VOICEVOX speech',
	changes: (_state, payload) => [{
		type: 'layer',
		sceneId: payload.sceneId,
		layerId: payload.layerId,
		changes: [{ type: 'definition' }],
	}],
	scope: payload => ({ sceneId: payload.sceneId, layerIds: [payload.layerId] }),
	edit: (state, payload) => {
		const find = (state: ProjectState) => {
			const layer = getTimelineLayer(state, payload.sceneId, payload.layerId);
			if (layer.layerType !== 'voicevox') throw new Error('VOICEVOX layer not found');
			return layer;
		};
		validateVoicevoxLayer(payload);
		const layer = find(state);

		Object.assign(layer, deepClone({ voicevox: payload.voicevox, utterances: payload.utterances }));
	},
});

export const removeTimelineKeyframesCommandDef = defineTimelineCommand<{ sceneId: string; keyframes: TimelineKeyframeSelection[] }>({
	label: 'Remove timeline keyframes',
	changes: (_state, payload) => [...new Set(payload.keyframes.map(point => point.layerId))].map(layerId => ({
		type: 'layer',
		sceneId: payload.sceneId,
		layerId,
		changes: [{ type: 'definition' }],
	})),
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		const scene = getScene(state, payload.sceneId);
		const layersById = new Map(flattenTimelineLayers(scene.layers).map(layer => [layer.id, layer]));
		// 編集用に分離済みのSceneを変更する。全件の削除に成功してからCommandが反映する。
		for (const point of payload.keyframes) {
			const layer = layersById.get(point.layerId);
			if (layer == null) throw new Error('Timeline layer not found');
			if (point.target === 'utterance') {
				if (layer.layerType !== 'voicevox' || (point.paramPath.length !== 1 || point.paramPath[0] !== 'utterances') || !layer.utterances.some(utterance => utterance.id === point.keyframeId)) throw new Error('Utterance not found');
				layer.utterances = layer.utterances.filter(utterance => utterance.id !== point.keyframeId);
			} else {
				const values = getLayerParameterValues(layer, point.target);
				if (values[point.paramPath[0]] == null) throw new Error('Timeline keyframe not found');
				const defs = getLayerParameterDefinitions(state, layer, point.target);
				const binding = resolveParameter<EditableTimelineParameterBinding>(defs, values, point.paramPath).value;
				if (binding.inputSource !== 'keyframesTimelineInline') throw new Error('Timeline keyframe not found');
				const keyframes = binding.keyframesTimeline.keyframes;
				const keyframeIndex = keyframes.findIndex(keyframe => keyframe.id === point.keyframeId);
				if (keyframeIndex < 0) throw new Error('Timeline keyframe not found');
				keyframes.splice(keyframeIndex, 1);
			}
		}
	},
});

export function wrapTimelineLayers(state: ProjectState, sceneId: string, layerIds: string[], container: TimelineContainerLayer) {
	const layers = getScene(state, sceneId).layers;
	if (container.layers.length || findTimelineLayer(layers, container.id)) throw new Error('Invalid new container');
	const locations = layerIds.map(id => findTimelineLayerLocation(layers, id));
	if (!locations.length) { layers.unshift(deepClone(container)); return; }
	const first = locations[0];
	if (!first || locations.some(location => !location || location.siblings !== first.siblings)) throw new Error('Container requires sibling layers');
	const indexes = locations.map(location => location!.index).sort((a, b) => a - b);
	if (indexes.some((index, offset) => index !== indexes[0] + offset)) throw new Error('Container requires consecutive layers');
	const children = first.siblings.splice(indexes[0], indexes.length);
	first.siblings.splice(indexes[0], 0, { ...deepClone(container), layers: children });
}

export const convertTimelineContainerCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; target: TimelineContainerLayerType }>({
	label: 'Convert timeline container',
	changes: (_state, payload) => [{ type: 'layerTree', sceneId: payload.sceneId }],
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		const layers = getScene(state, payload.sceneId).layers;
		const location = findTimelineLayerLocation(layers, payload.layerId);
		if (location == null || !isTimelineContainerLayer(location.layer)) throw new Error('Container not found');
		location.siblings.splice(location.index, 1, convertTimelineContainerLayer(location.layer, payload.target));
	},
});

export const duplicateTimelineLayersCommandDef = defineTimelineCommand<{ sceneId: string; layers: { layer: TimelineLayer; sourceLayerId: string }[]; sourceDurationsMs?: TimelineClipSourceDurations | null }>({
	label: 'Duplicate timeline layers',
	changes: (_state, payload) => [{ type: 'layerTree', sceneId: payload.sceneId }],
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		const layers = getScene(state, payload.sceneId).layers;
		for (const entry of payload.layers) {
			validateAddedTimelineLayer(state, payload.sceneId, entry.layer, payload.sourceDurationsMs);
			const location = findTimelineLayerLocation(layers, entry.sourceLayerId);
			if (location == null) throw new Error('Source layer not found');
			location.siblings.splice(location.index, 0, deepClone(entry.layer));
		}
	},
});

export const removeTimelineLayersCommandDef = defineTimelineCommand<{ sceneId: string; layerIds: string[] }>({
	label: 'Remove timeline layers',
	changes: (_state, payload) => [{ type: 'layerTree', sceneId: payload.sceneId }],
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		const layers = getScene(state, payload.sceneId).layers;
		const locations = [...new Set(payload.layerIds)].map(id => findTimelineLayerLocation(layers, id));
		if (locations.some(location => !location)) throw new Error('Layer not found');
		// 親と子の同時選択では親だけを削除し、選択順に左右されない一操作にする。
		const roots = locations.filter(location => !location!.ancestors.some(ancestor => payload.layerIds.includes(ancestor.id)));
		for (const root of roots) {
			const location = findTimelineLayerLocation(layers, root!.layer.id)!;
			location.siblings.splice(location.index, 1);
		}
	},
});

export const unwrapTimelineLayerCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string }>({
	label: 'Unwrap timeline container',
	changes: (_state, payload) => [{ type: 'layerTree', sceneId: payload.sceneId }],
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		const layers = getScene(state, payload.sceneId).layers;
		const location = findTimelineLayerLocation(layers, payload.layerId);
		if (!location || !isTimelineContainerLayer(location.layer)) throw new Error('Container not found');
		location.siblings.splice(location.index, 1, ...location.layer.layers);
	},
});

export const moveTimelineLayerInTreeCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; parentId: string | null; beforeId: string | null }>({
	label: 'Move timeline layer',
	changes: (_state, payload) => [{ type: 'layerTree', sceneId: payload.sceneId }],
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		const layers = getScene(state, payload.sceneId).layers;
		const source = findTimelineLayerLocation(layers, payload.layerId);
		if (!source) throw new Error('Layer not found');
		if (payload.parentId && findTimelineLayer([source.layer], payload.parentId)) throw new Error('Cannot move a container into itself');
		const parent = payload.parentId ? findTimelineLayer(layers, payload.parentId) : null;
		if (payload.parentId && (!parent || !isTimelineContainerLayer(parent))) throw new Error('Parent container not found');
		const destination = parent && isTimelineContainerLayer(parent) ? parent.layers : layers;
		if (payload.beforeId === source.layer.id && destination === source.siblings) return;
		const before = payload.beforeId ? destination.find(layer => layer.id === payload.beforeId) : null;
		if (payload.beforeId && !before) throw new Error('Destination layer not found');
		source.siblings.splice(source.index, 1);
		destination.splice(before ? destination.indexOf(before) : destination.length, 0, source.layer);
	},
});

export const moveTimelineContainerInTimeCommandDef = defineTimelineCommand<{ sceneId: string; layerId: string; deltaMs: number }>({
	label: 'Move timeline container',
	changes: (state, payload) => {
		const group = getTimelineLayer(state, payload.sceneId, payload.layerId);
		return flattenTimelineLayers([group]).map(layer => ({
			type: 'layer' as const,
			sceneId: payload.sceneId,
			layerId: layer.id,
			changes: layer.layerType === 'voicevox' ? [{ type: 'definition' as const }] : [
				...(isTimelineContainerLayer(layer) ? [] : [{ type: 'clips' as const }]),
				...getLayerParameterTargets(layer).map(target => ({ type: 'parameter' as const, target, kind: 'value' as const })),
			],
		}));
	},
	scope: payload => ({ sceneId: payload.sceneId }),
	edit: (state, payload) => {
		const container = getTimelineLayer(state, payload.sceneId, payload.layerId);
		if (!isTimelineContainerLayer(container) || !Number.isSafeInteger(payload.deltaMs)) throw new Error('Invalid container move');
		const initial = prepareTimelineContainerMove(state, container);
		if (payload.deltaMs < initial.minDelta || payload.deltaMs > initial.maxDelta) throw new Error('Timeline edit is outside the valid range');
		moveTimelineKeyframesInDraft(state, getScene(state, payload.sceneId), initial.keyframes.map(point => ({ ...point, x: point.x + payload.deltaMs })));
		for (const clip of initial.clips) getTimelineClip(state, payload.sceneId, clip).clip.startMs = clip.startMs + payload.deltaMs;
	},
});

export const replaceTimelineClipTimingPreparation = defineTimelineCommand<TimelineClipTarget & { sceneId: string; timing: TimelineClipTiming | TimelineMediaClipTiming | TimelineVideoHoldTiming; sourceDurationMs?: number | null }>({
	label: 'Replace timeline clip timing',
	scope: input => ({ sceneId: input.sceneId, layerIds: [input.layerId] }),
	changes: (_state, input) => [{ type: 'layer', sceneId: input.sceneId, layerId: input.layerId, changes: [{ type: 'clips' }] }],
	edit: (state, input) => {
		const { layer, clip } = getTimelineClip(state, input.sceneId, input);
		const next = { ...clip, ...deepClone(input.timing) };
		if (('sourceInMs' in clip) !== ('sourceInMs' in input.timing) || ('sourceTimeMs' in clip) !== ('sourceTimeMs' in input.timing)) throw new Error('Clip timing kind cannot change');
		validateTimelineClips(layer.clips.map(value => value.id === clip.id ? next : value));
		if (layer.layerType === 'audio' || layer.layerType === 'video') validateMediaClipTiming(next, input.sourceDurationMs);
		Object.assign(clip, next);
	},
});

export const setTimelinePositionsCommandDef = defineTimelineCommand<{ sceneId: string; clips: (TimelineClipTarget & { startMs: number })[]; keyframes: TimelineKeyframePosition[] }>({
	label: 'Set timeline positions',
	scope: input => ({ sceneId: input.sceneId, layerIds: [...input.clips.map(clip => clip.layerId), ...input.keyframes.map(point => point.layerId)] }),
	changes: (state, input) => [...new Set([...input.clips.map(clip => clip.layerId), ...input.keyframes.map(point => point.layerId)])].map(layerId => ({
		type: 'layer', sceneId: input.sceneId, layerId,
		changes: [{ type: 'clips' }, ...getLayerParameterTargets(getTimelineLayer(state, input.sceneId, layerId)).map(target => ({ type: 'parameter' as const, target, kind: 'value' as const })), ...(getTimelineLayer(state, input.sceneId, layerId).layerType === 'voicevox' ? [{ type: 'definition' as const }] : [])],
	})),
	edit: (state, input) => {
		if (new Set(input.clips.map(clip => JSON.stringify([clip.layerId, clip.clipId]))).size !== input.clips.length) throw new Error('Duplicate clip target');
		moveTimelineKeyframesInDraft(state, getScene(state, input.sceneId), input.keyframes);
		for (const position of input.clips) getTimelineClip(state, input.sceneId, position).clip.startMs = position.startMs;
		for (const layerId of new Set(input.clips.map(clip => clip.layerId))) validateTimelineClips(getTimelineClipLayer(state, input.sceneId, layerId).clips);
	},
});

export const TIMELINE_BASIC_COMMAND_DEFS = {
	setTimelinePositions: withCommandContract(setTimelinePositionsCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelinePositions),
	convertTimelineContainer: withCommandContract(convertTimelineContainerCommandDef, TIMELINE_COMMAND_CONTRACTS.convertTimelineContainer),
	unwrapTimelineLayer: withCommandContract(unwrapTimelineLayerCommandDef, TIMELINE_COMMAND_CONTRACTS.unwrapTimelineLayer),
	moveTimelineLayerInTree: withCommandContract(moveTimelineLayerInTreeCommandDef, TIMELINE_COMMAND_CONTRACTS.moveTimelineLayerInTree),
	moveTimelineContainerInTime: withCommandContract(moveTimelineContainerInTimeCommandDef, TIMELINE_COMMAND_CONTRACTS.moveTimelineContainerInTime),
	removeTimelineKeyframes: withCommandContract(removeTimelineKeyframesCommandDef, TIMELINE_COMMAND_CONTRACTS.removeTimelineKeyframes),
	replaceTimelineVoicevoxContent: withCommandContract(replaceTimelineVoicevoxContentCommandDef, TIMELINE_COMMAND_CONTRACTS.replaceTimelineVoicevoxContent),
	setTimelineLayerStaticSetting: withCommandContract(setTimelineLayerStaticSettingCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelineLayerStaticSetting),
	setTimelineEffectLayerResolution: withCommandContract(setTimelineEffectLayerResolutionCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelineEffectLayerResolution),
	setTimelineLayerName: withCommandContract(setTimelineLayerNameCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelineLayerName),
	setTimelineLayerColor: withCommandContract(setTimelineLayerColorCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelineLayerColor),
	setTimelineLayerDisabled: withCommandContract(setTimelineLayerDisabledCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelineLayerDisabled),
	setTimelineLayerSolo: withCommandContract(setTimelineLayerSoloCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelineLayerSolo),
	clearTimelineSolo: withCommandContract(clearTimelineSoloCommandDef, TIMELINE_COMMAND_CONTRACTS.clearTimelineSolo),
	setTimelineLayerCoordinateSpace: withCommandContract(setTimelineLayerCoordinateSpaceCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelineLayerCoordinateSpace),
	setTimelineLayerTransformTarget: withCommandContract(setTimelineLayerTransformTargetCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelineLayerTransformTarget),
	setTimelineLayerMask: withCommandContract(setTimelineLayerMaskCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelineLayerMask),
	setTimelineLayerReferenceMask: withCommandContract(setTimelineLayerReferenceMaskCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelineLayerReferenceMask),
	setTimelineLayerCompositeInclusion: withCommandContract(setTimelineLayerCompositeInclusionCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelineLayerCompositeInclusion),
	setTimelineLayerMotionBlurDisabled: withCommandContract(setTimelineLayerMotionBlurDisabledCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelineLayerMotionBlurDisabled),
	moveTimelineClips: withCommandContract(moveTimelineClipsCommandDef, TIMELINE_COMMAND_CONTRACTS.moveTimelineClips),
	removeTimelineClips: withCommandContract(removeTimelineClipsCommandDef, TIMELINE_COMMAND_CONTRACTS.removeTimelineClips),
	setTimelineVideoClipAudioEnabled: withCommandContract(setTimelineVideoClipAudioEnabledCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelineVideoClipAudioEnabled),
	setTimelineVideoClipVideoEnabled: withCommandContract(setTimelineVideoClipVideoEnabledCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelineVideoClipVideoEnabled),
	moveTimelineKeyframes: withCommandContract(moveTimelineKeyframesCommandDef, TIMELINE_COMMAND_CONTRACTS.moveTimelineKeyframes),
	insertTimelineKeyframes: withCommandContract(insertTimelineKeyframesCommandDef, TIMELINE_COMMAND_CONTRACTS.insertTimelineKeyframes),
	setTimelineSceneResolution: withCommandContract(setTimelineSceneResolutionCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelineSceneResolution),
	setTimelineGroupCompositingMode: withCommandContract(setTimelineGroupCompositingModeCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelineGroupCompositingMode),
	setTimelineSceneName: withCommandContract(setTimelineSceneNameCommandDef, TIMELINE_COMMAND_CONTRACTS.setTimelineSceneName),
	removeTimelineScene: withCommandContract(removeTimelineSceneCommandDef, TIMELINE_COMMAND_CONTRACTS.removeTimelineScene),
	reorderTimelineLayers: withCommandContract(reorderTimelineLayersCommandDef, TIMELINE_COMMAND_CONTRACTS.reorderTimelineLayers),
	removeTimelineLayers: withCommandContract(removeTimelineLayersCommandDef, TIMELINE_COMMAND_CONTRACTS.removeTimelineLayers),
};

