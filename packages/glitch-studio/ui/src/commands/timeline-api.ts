import { genId } from '@gs/shared/utility/id.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { getTimelineClipLayers, findTimelineLayerLocation } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { validateSceneResolution } from '@gs/subsystems_timeline_shared/scene-resolution.ts';
import { getTimelineClipMedia } from '../utility/timeline-clip-media.ts';
import { duplicateTimelineLayers } from '../utility/timeline-container.ts';
import { getScene } from '../utility/timeline-scene.ts';
import { prepareTimelineEdit } from './timeline-preparation.ts';
import { createTimelineLayerFromRecipe } from './timeline-creation.ts';
import { definePublicCommand, withCommandContract } from './definition.ts';
import { TIMELINE_COMMAND_CONTRACTS } from './timeline-command-contracts.ts';
import * as timeline from './timeline.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { TimelineScene, TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineContainerLayerType } from '@gs/subsystems_timeline_shared/container-layer.ts';
import type { ProjectState } from '../Project.ts';
import type { TimelineClipMediaInfo, TimelineClipSourceDurations } from '../utility/timeline-clip-media.ts';
import type { CommandDef } from './definition.ts';
import type { TimelineLayerRecipe, TimelineClipRecipe, TimelineLayerReference, TimelineClipReference } from './timeline-creation.ts';

export type TimelineCommandServices = { inspectMedia: (asset: Asset) => TimelineClipMediaInfo | Promise<TimelineClipMediaInfo> };
type SourceMetadata = { sourceDurationMs?: number | null; sourceDurationsMs?: TimelineClipSourceDurations | null };
type MediaTarget = { layerId: string; clipId: string; assetId: string };

function mediaTargets(layers: readonly TimelineLayer[]): MediaTarget[] {
	return getTimelineClipLayers([...layers]).flatMap(layer => layer.layerType === 'video' || layer.layerType === 'audio'
		? layer.clips.map(clip => ({ layerId: layer.id, clipId: clip.id, assetId: clip.assetId })) : []);
}

/** 外部素材の読み出しは準備時だけに閉じ、確定済みのRedoにI/Oを持ち込まない。 */
export function createTimelineCommandDefinitions(services: TimelineCommandServices = { inspectMedia: getTimelineClipMedia }) {
	function prepareWithMedia<Input extends SourceMetadata, Result>(definition: CommandDef<Input, Result>, state: ProjectState, input: Omit<Input, keyof SourceMetadata>, targets: MediaTarget[]) {
		const captured = deepClone(input);
		const inspected = targets.map(target => {
			const asset = state.assets.value.find(value => value.id === target.assetId);
			if (asset == null) throw new Error('Timeline media asset not found');
			return services.inspectMedia(asset);
		});
		const prepare = (metadata: TimelineClipMediaInfo[]) => {
			const sourceDurationsMs: TimelineClipSourceDurations = {};
			metadata.forEach((info, index) => { (sourceDurationsMs[targets[index].layerId] ??= {})[targets[index].clipId] = info.durationMs; });
			return definition.prepare(state, { ...captured, sourceDurationMs: metadata[0]?.durationMs ?? null, sourceDurationsMs } as Input);
		};
		return inspected.some(value => value instanceof Promise) ? Promise.all(inspected).then(prepare) : prepare(inspected as TimelineClipMediaInfo[]);
	}

	function mediaCommand<Input extends SourceMetadata & timeline.TimelineClipTarget & { sceneId: string }, Result>(definition: CommandDef<Input, Result>): CommandDef<Omit<Input, keyof SourceMetadata>, Result> {
		return { label: definition.label, prepare: (state, input) => {
			const { layer, clip } = timeline.getTimelineClip(state, input.sceneId, input);
			const assetId = 'assetId' in input && typeof input.assetId === 'string' ? input.assetId : 'assetId' in clip ? clip.assetId : null;
			const targets = (layer.layerType === 'video' || layer.layerType === 'audio') && assetId != null ? [{ layerId: layer.id, clipId: clip.id, assetId }] : [];
			return prepareWithMedia(definition, state, input, targets);
		} };
	}

	const createTimelineLayer: CommandDef<{ sceneId: string; layer: TimelineLayerRecipe; clips?: TimelineClipRecipe[] }, TimelineLayerReference> = {
		label: 'Create timeline layer', prepare: (state, input) => {
			const layer = createTimelineLayerFromRecipe(state, input.layer, input.clips);
			const prepared = prepareWithMedia(timeline.addTimelineLayerCommandDef, state, { sceneId: input.sceneId, layer }, mediaTargets([layer]));
			const result = { sceneId: input.sceneId, layerId: layer.id };
			return prepared instanceof Promise ? prepared.then(value => ({ ...value, result })) : { ...prepared, result };
		},
	};
	const createTimelineClip: CommandDef<{ sceneId: string; layerId: string; clip: TimelineClipRecipe }, TimelineClipReference> = {
		label: 'Create timeline clip', prepare: (state, input) => {
			const clip = { ...deepClone(input.clip), id: genId() } as timeline.TimelineClipData;
			const layer = timeline.getTimelineClipLayer(state, input.sceneId, input.layerId);
			const targets = (layer.layerType === 'video' || layer.layerType === 'audio') && 'assetId' in clip ? [{ layerId: layer.id, clipId: clip.id, assetId: clip.assetId }] : [];
			const prepared = prepareWithMedia(timeline.addTimelineClipCommandDef, state, { sceneId: input.sceneId, layerId: input.layerId, clip }, targets);
			const result = { sceneId: input.sceneId, layerId: input.layerId, clipId: clip.id };
			return prepared instanceof Promise ? prepared.then(value => ({ ...value, result })) : { ...prepared, result };
		},
	};
	const insertTimelineLayer: CommandDef<{ sceneId: string; layer: TimelineLayer; beforeLayerId?: string | null }, TimelineLayerReference> = {
		label: 'Insert timeline layer', prepare: (state, input) => {
			const [layer] = duplicateTimelineLayers([input.layer]);
			const prepared = prepareWithMedia(timeline.pasteTimelineLayerCommandDef, state, { sceneId: input.sceneId, layer, sourceLayerId: input.beforeLayerId ?? '' }, mediaTargets([layer]));
			const result = { sceneId: input.sceneId, layerId: layer.id };
			return prepared instanceof Promise ? prepared.then(value => ({ ...value, result })) : { ...prepared, result };
		},
	};
	const createTimelineScene = definePublicCommand({
		...TIMELINE_COMMAND_CONTRACTS.createTimelineScene,
		label: 'Create timeline scene', prepare: (state, input) => {
			if (input.name != null && typeof input.name !== 'string') throw new Error('Scene name must be a string');
			const scene: TimelineScene = { id: genId(), name: input.name ?? 'Scene', resolution: deepClone(input.resolution ?? { mode: 'project' }), layers: [] };
			validateSceneResolution(scene.resolution);
			return prepareTimelineEdit(state, { scenes: true }, draft => { draft.timelineScenes.value.push(scene); return { sceneId: scene.id }; }, () => [{ type: 'scene', sceneId: scene.id }]);
		},
	});
	const duplicateTimelineScene = definePublicCommand({
		...TIMELINE_COMMAND_CONTRACTS.duplicateTimelineScene,
		label: 'Duplicate timeline scene', prepare: (state, input) => {
			if (input.name != null && typeof input.name !== 'string') throw new Error('Scene name must be a string');
			const source = getScene(state, input.sceneId);
			const scene = { ...deepClone(source), id: genId(), name: input.name ?? source.name, layers: duplicateTimelineLayers(source.layers) };
			return prepareTimelineEdit(state, { scenes: true }, draft => { draft.timelineScenes.value.push(scene); return { sceneId: scene.id }; }, () => [{ type: 'scene', sceneId: scene.id }]);
		},
	});
	const duplicateLayers: CommandDef<{ sceneId: string; layerIds: string[] }, TimelineLayerReference[]> = {
		label: 'Duplicate timeline layers', prepare: (state, input) => {
			const scene = getScene(state, input.sceneId);
			if (new Set(input.layerIds).size !== input.layerIds.length) throw new Error('Duplicate layer selection');
			const locations = input.layerIds.map(id => { const location = findTimelineLayerLocation(scene.layers, id); if (location == null) throw new Error('Timeline layer not found'); return location; });
			const roots = locations.filter(location => !location.ancestors.some(ancestor => input.layerIds.includes(ancestor.id)));
			const layers = duplicateTimelineLayers(roots.map(location => location.layer));
			const prepared = prepareWithMedia(timeline.duplicateTimelineLayersCommandDef, state, { sceneId: input.sceneId, layers: layers.map((layer, index) => ({ layer, sourceLayerId: roots[index].layer.id })) }, mediaTargets(layers));
			const result = layers.map(layer => ({ sceneId: input.sceneId, layerId: layer.id }));
			return prepared instanceof Promise ? prepared.then(value => ({ ...value, result })) : { ...prepared, result };
		},
	};
	const wrapLayers: CommandDef<{ sceneId: string; layerIds: string[]; containerType: TimelineContainerLayerType; name?: string }, TimelineLayerReference> = {
		label: 'Wrap timeline layers', prepare: (state, input) => {
			const container = createTimelineLayerFromRecipe(state, { layerType: input.containerType, name: input.name });
			if (!('layers' in container)) throw new Error('Expected container layer');
			const result = { sceneId: input.sceneId, layerId: container.id };
			return prepareTimelineEdit(state, { sceneId: input.sceneId }, draft => { timeline.wrapTimelineLayers(draft, input.sceneId, input.layerIds, container); return result; }, () => [{ type: 'layerTree', sceneId: input.sceneId }]);
		},
	};
	return {
		...timeline.TIMELINE_BASIC_COMMAND_DEFS,
		insertTimelineAssetLayers: timeline.addTimelineAssetLayersCommandDef,
		createTimelineLayer: withCommandContract(createTimelineLayer, TIMELINE_COMMAND_CONTRACTS.createTimelineLayer),
		createTimelineClip: withCommandContract(createTimelineClip, TIMELINE_COMMAND_CONTRACTS.createTimelineClip),
		createTimelineScene, duplicateTimelineScene,
		insertTimelineLayer: withCommandContract(insertTimelineLayer, TIMELINE_COMMAND_CONTRACTS.insertTimelineLayer),
		duplicateTimelineLayers: withCommandContract(duplicateLayers, TIMELINE_COMMAND_CONTRACTS.duplicateTimelineLayers),
		wrapTimelineLayers: withCommandContract(wrapLayers, TIMELINE_COMMAND_CONTRACTS.wrapTimelineLayers),
		trimTimelineClip: withCommandContract(mediaCommand(timeline.trimTimelineClipCommandDef), TIMELINE_COMMAND_CONTRACTS.trimTimelineClip),
		replaceTimelineClipTiming: withCommandContract(mediaCommand(timeline.replaceTimelineClipTimingPreparation), TIMELINE_COMMAND_CONTRACTS.replaceTimelineClipTiming),
		resizeTimelineMediaClipLoop: withCommandContract(mediaCommand(timeline.resizeTimelineMediaClipLoopCommandDef), TIMELINE_COMMAND_CONTRACTS.resizeTimelineMediaClipLoop),
		setTimelineMediaClipPlaybackRate: withCommandContract(mediaCommand(timeline.setTimelineMediaClipPlaybackRateCommandDef), TIMELINE_COMMAND_CONTRACTS.setTimelineMediaClipPlaybackRate),
		setTimelineClipSource: withCommandContract(mediaCommand(timeline.setTimelineClipSourceCommandDef), TIMELINE_COMMAND_CONTRACTS.setTimelineClipSource),
		holdTimelineVideoClipFrame: withCommandContract(mediaCommand(timeline.holdTimelineVideoClipFrameCommandDef), TIMELINE_COMMAND_CONTRACTS.holdTimelineVideoClipFrame),
		insertTimelineClips: withCommandContract({
			label: 'Insert timeline clips', prepare: (state: ProjectState, input: Omit<Parameters<typeof timeline.insertTimelineClipsCommandDef.prepare>[1], keyof SourceMetadata>) => {
				const targets = input.clips.flatMap(entry => {
					const layer = timeline.getTimelineClipLayer(state, input.sceneId, entry.layerId);
					return (layer.layerType === 'video' || layer.layerType === 'audio') && 'assetId' in entry.clip ? [{ layerId: layer.id, clipId: entry.clip.id, assetId: entry.clip.assetId }] : [];
				});
				return prepareWithMedia(timeline.insertTimelineClipsCommandDef, state, input, targets);
			},
		}, TIMELINE_COMMAND_CONTRACTS.insertTimelineClips),
	};
}
