import { createTimelineClipTiming, getTimelineClipInsertionDuration } from '@gs/subsystems_timeline_shared/timing.ts';
import { canReferenceScene } from '@gs/subsystems_timeline_shared/scenes.ts';
import { shapeDefinitions } from '@gs/subsystems_timeline_shared/layers/shape/shape.ts';
import { timelineAudioParamDefs } from '@gs/subsystems_timeline_shared/timeline-audio.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { Ref } from 'vue';
import type { Asset } from '@gs/shared/types.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { TimelineLayer, TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { ShapeType } from '@gs/subsystems_timeline_shared/layers/shape/shape.ts';
import type { ProjectState, AppStateChange } from '@/Project.ts';
import type { COMMAND_DEFS } from '@/commands.ts';
import type { UndoRedo } from './undo-redo.ts';
import type { TimelineClipSelection } from './timeline-selection.ts';
import type { TimelineClipMediaInfo, TimelineClipSourceDurations } from './timeline-clip-media.ts';
import { createEffectTimelineLayer } from './effect-timeline-layer.ts';
import { createShapeTimelineLayer } from './shape-timeline-layer.ts';
import { createVoicevoxTimelineLayer } from './voicevox-timeline-layer.ts';
import { createTextTimelineLayer } from './text-timeline-layer.ts';
import { createInlineVisualModuleLayer } from './inline-visual-module-layer.ts';

type TimelineSourceActionsOptions = {
	stateManager: Pick<UndoRedo<ProjectState, AppStateChange, typeof COMMAND_DEFS>, 'state' | 'commit'>;
	scene: TimelineScene;
	sceneLayers: Readonly<Ref<TimelineLayer[]>>;
	currentTime: Readonly<Ref<number>>;
	isActive: () => boolean;
	inspectMedia: (asset: Asset) => Promise<TimelineClipMediaInfo>;
	ui: Pick<typeof import('@/ui.ts'), 'select' | 'confirm' | 'popupMenu' | 'alert'>;
	pickEffect: (chosen: (definition: EffectDefinition) => void) => void;
	desktopAvailable: () => boolean;
	selectLayer: (layer: TimelineLayer) => void;
	selectClip: (target: TimelineClipSelection) => void;
	addEmptyGroup: () => void;
	seek: (timeMs: number) => void;
	reportError: (error: unknown) => void;
};

/** 素材・Sceneの選択、クリップの追加・差し替え、レイヤー追加をCommandへつなぐ。DOMとピッカーの寿命は呼び出し側が所有する。 */
export function createTimelineSourceActions(options: TimelineSourceActionsOptions) {
	const { stateManager, scene, sceneLayers, currentTime: time, isActive, inspectMedia, ui, pickEffect,
		desktopAvailable, selectLayer, selectClip, addEmptyGroup, seek, reportError } = options;
	const availableScenes = () => stateManager.state.timelineScenes.value.filter(candidate => canReferenceScene(stateManager.state.timelineScenes.value, scene.id, candidate.id));

	type ClipSource = { kind: 'asset'; asset: Asset; media?: TimelineClipMediaInfo } | { kind: 'scene'; scene: TimelineScene };

	function resolveClip(target: TimelineClipSelection) {
		const layer = sceneLayers.value.find(layer => layer.id === target.layerId);
		if (layer == null || layer.layerType === 'group') return null;
		const clip = layer.clips.find(clip => clip.id === target.clipId);
		return clip ? { layer, clip, target } : null;
	}

	async function chooseClipSource(layerType: 'image' | 'video' | 'audio' | 'scene'): Promise<ClipSource | null> {
		const initialLayers = sceneLayers.value;
		const assets = stateManager.state.assets.value;
		if (layerType === 'scene') {
			const { canceled, result: id } = await ui.select({ title: 'Select Scene', items: availableScenes().map(scene => ({ label: scene.name, value: scene.id })) });
			const selected = availableScenes().find(scene => scene.id === id);
			return canceled || !selected || !isActive() || sceneLayers.value !== initialLayers ? null : { kind: 'scene', scene: selected };
		}
		const { canceled, result: id } = await ui.select({
			title: 'Select ' + layerType + ' asset',
			items: assets.filter(asset => asset.fileDataType.startsWith(layerType + '/')).map(asset => ({ label: asset.name, value: asset.id })),
		});
		const asset = assets.find(asset => asset.id === id);
		if (canceled || !asset || !isActive() || sceneLayers.value !== initialLayers || stateManager.state.assets.value !== assets) return null;
		const blob = asset.fileData;
		try {
			const media = layerType === 'image' ? undefined : await inspectMedia(asset);
			if (!isActive() || sceneLayers.value !== initialLayers || !stateManager.state.assets.value.includes(asset) || asset.fileData !== blob) return null;
			if (media?.audioError) {
				const result = await ui.confirm({ type: 'warning', title: asset.name, text: media.audioError, okText: 'Add without audio' });
				if (result.canceled || !isActive() || sceneLayers.value !== initialLayers || !stateManager.state.assets.value.includes(asset) || asset.fileData !== blob) return null;
			}
			return { kind: 'asset', asset, media };
		} catch (error) { reportError(error); return null; }
	}

	async function addClip(layer: TimelineLayer, startMs: number) {
		if (layer.layerType === 'group') return;
		startMs = Math.round(startMs);
		if (getTimelineClipInsertionDuration(layer.clips, startMs) <= 0) return;
		const type = layer.layerType;
		const source = type === 'image' || type === 'video' || type === 'audio' || type === 'scene' ? await chooseClipSource(type) : null;
		if (!isActive() || !sceneLayers.value.includes(layer)) return;
		if ((type === 'image' || type === 'video' || type === 'audio' || type === 'scene') && !source) return;
		// ピッカー待機中にも他のクリップが動くので、追加直前の空きを使う。
		const sourceDurationMs = source?.kind === 'asset' ? source.media?.durationMs : undefined;
		const durationMs = getTimelineClipInsertionDuration(layer.clips, startMs, Math.min(5000, sourceDurationMs ?? Infinity));
		if (durationMs <= 0) return;
		const clip = {
			id: genId(),
			...createTimelineClipTiming(startMs, durationMs),
			...(source?.kind === 'scene' ? { sceneId: source.scene.id } : source?.kind === 'asset' ? { assetId: source.asset.id } : {}),
			...(type === 'video' ? { audioEnabled: source?.kind === 'asset' && !!source.media?.audioAvailable } : {}),
		};
		try {
			stateManager.commit('addTimelineClip', { sceneId: scene.id, layerId: layer.id, clip, sourceDurationMs });
			selectClip({ layerId: layer.id, clipId: clip.id });
		} catch (error) { reportError(error); }
	}

	async function changeClipSource(target: TimelineClipSelection) {
		const entry = resolveClip(target);
		if (!entry) return;
		const type = entry.layer.layerType;
		if (type !== 'image' && type !== 'video' && type !== 'audio' && type !== 'scene') return;
		const source = await chooseClipSource(type);
		if (!source || !isActive() || resolveClip(entry.target)?.clip !== entry.clip) return;
		if (source.kind === 'asset' && 'assetId' in entry.clip && entry.clip.assetId === source.asset.id) return;
		if (source.kind === 'scene' && 'sceneId' in entry.clip && entry.clip.sceneId === source.scene.id) return;
		try {
			stateManager.commit('changeTimelineClipSource', {
				sceneId: scene.id,
				...entry.target,
				...(source.kind === 'scene' ? {
					referencedSceneId: source.scene.id,
				} : {
					assetId: source.asset.id, sourceDurationMs: source.media?.durationMs,
					audioEnabled: !!source.media?.audioAvailable && (!('audioEnabled' in entry.clip) || entry.clip.audioEnabled === true),
				}),
			});
		} catch (error) { reportError(error); }
	}

	async function readLayerMediaDurations(layer: TimelineLayer): Promise<TimelineClipSourceDurations | undefined> {
		if (layer.layerType === 'group') return Object.assign(Object.create(null), ...await Promise.all(layer.layers.map(readLayerMediaDurations)));
		if (layer.layerType !== 'audio' && layer.layerType !== 'video') return undefined;
		const sources = layer.clips.map(clip => {
			const asset = stateManager.state.assets.value.find(asset => asset.id === clip.assetId);
			if (!asset) throw new Error('Missing media');
			return { clipId: clip.id, asset, blob: asset.fileData };
		});
		const durations = await Promise.all(sources.map(async ({ clipId, asset }) => [clipId, (await inspectMedia(asset)).durationMs] as const));
		if (sources.some(({ asset, blob }) => !stateManager.state.assets.value.includes(asset) || asset.fileData !== blob)) throw new Error('Media changed during loading');
		return { [layer.id]: Object.fromEntries(durations) };
	}

	function initialCompositingParameters() {
		return deepClone(Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, def.defaultValue]))) as import('@gs/subsystems_timeline_shared/types.ts').TimelineImageLayer['compositingParamValues'];
	}

	async function addMediaLayer(layerType: 'image' | 'video' | 'audio' | 'scene') {
		const source = await chooseClipSource(layerType);
		if (!source || !isActive()) return;
		const sourceDurationMs = source.kind === 'asset' ? source.media?.durationMs : undefined;
		const clip = { id: genId(), ...createTimelineClipTiming(Math.max(0, time.value), Math.min(5000, sourceDurationMs ?? Infinity)) };
		if (clip.durationMs < 1) { reportError(new Error('Media is shorter than 1 ms.')); return; }
		const base = { id: genId(), name: source.kind === 'asset' ? source.asset.name : source.scene.name, automationGraphs: [], isDisabled: false };
		const audioParamValues = { volume: deepClone(timelineAudioParamDefs.volume.defaultValue) };
		const compositingParamValues = initialCompositingParameters();
		let layer: TimelineLayer;
		if (layerType === 'scene' && source.kind === 'scene') layer = { ...base, layerType, clips: [{ ...clip, sceneId: source.scene.id }], audioParamValues, compositingParamValues };
		else if (source.kind === 'asset' && layerType === 'image') layer = { ...base, layerType, clips: [{ ...clip, assetId: source.asset.id }], compositingParamValues };
		else if (source.kind === 'asset' && layerType === 'audio') layer = { ...base, layerType, clips: [{ ...clip, assetId: source.asset.id }], audioParamValues };
		else if (source.kind === 'asset' && layerType === 'video') layer = { ...base, layerType, clips: [{ ...clip, assetId: source.asset.id, audioEnabled: !!source.media?.audioAvailable }], audioParamValues, compositingParamValues };
		else return;
		stateManager.commit('addTimelineLayer', { sceneId: scene.id, layer, sourceDurationsMs: sourceDurationMs == null ? undefined : { [layer.id]: { [clip.id]: sourceDurationMs } } });
		selectClip({ layerId: layer.id, clipId: clip.id });
	}

	async function addReferencedVisualModuleLayer() {
		const initialLayers = sceneLayers.value;
		const { canceled, result: id } = await ui.select({ title: 'Select Visual Module', items: stateManager.state.visualModules.value.map(visualModule => ({ label: visualModule.name, value: visualModule.id })) });
		const visualModule = stateManager.state.visualModules.value.find(visualModule => visualModule.id === id);
		if (canceled || !visualModule || !isActive() || sceneLayers.value !== initialLayers) return;
		const layer: TimelineLayer = {
			id: genId(), name: visualModule.name,
			layerType: 'visualModule',
			isDisabled: false,
			visualModuleId: visualModule.id,
			clips: [{ id: genId(), ...createTimelineClipTiming(Math.max(0, time.value), 5000) }],
			visualModuleParamValues: {}, compositingParamValues: initialCompositingParameters(), automationGraphs: [],
		};
		stateManager.commit('addTimelineLayer', { sceneId: scene.id, layer });
		selectLayer(layer);
	}

	function showAddEffectLayerMenu() {
		const startMs = Math.max(0, time.value);
		pickEffect(definition => {
			if (!isActive()) return;
			const layer = createEffectTimelineLayer(definition, startMs);
			stateManager.commit('addTimelineLayer', { sceneId: scene.id, layer });
			selectLayer(layer);
			seek(layer.clips[0].startMs);
		});
	}

	function showAddLayerMenu(ev: PointerEvent) {
		ui.popupMenu([{
			text: 'Group', icon: 'ti ti-folder-plus', action: addEmptyGroup,
		}, {
			text: 'Effect',
			icon: 'ti ti-sparkles',
			action: showAddEffectLayerMenu,
		}, {
			text: 'Text',
			icon: 'ti ti-typography',
			action: () => {
				const layer = createTextTimelineLayer(Math.max(0, time.value));
				stateManager.commit('addTimelineLayer', { sceneId: scene.id, layer });
				selectLayer(layer);
				seek(layer.clips[0].startMs);
			},
		}, {
			type: 'parent',
			text: 'Shape',
			icon: 'ti ti-shape',
			children: (Object.keys(shapeDefinitions) as ShapeType[]).map(type => ({
				text: shapeDefinitions[type].label,
				icon: type === 'ellipse' ? 'ti ti-circle' : 'ti ti-rectangle',
				action: () => {
					const layer = createShapeTimelineLayer(type, Math.max(0, time.value));
					stateManager.commit('addTimelineLayer', { sceneId: scene.id, layer });
					selectLayer(layer);
					seek(layer.clips[0].startMs);
				},
			})),
		}, {
			text: 'Image',
			icon: 'ti ti-photo',
			action: () => addMediaLayer('image'),
		}, {
			text: 'Video',
			icon: 'ti ti-video',
			action: () => addMediaLayer('video'),
		}, {
			text: 'Audio',
			icon: 'ti ti-music',
			action: () => addMediaLayer('audio'),
		}, {
			text: 'Visual Module (Inline)',
			icon: 'ti ti-chart-dots-3',
			action: () => {
				const layer = createInlineVisualModuleLayer(Math.max(0, time.value));
				stateManager.commit('addTimelineLayer', { sceneId: scene.id, layer });
				selectLayer(layer);
				seek(layer.clips[0].startMs);
			},
		}, {
			text: 'Visual Module (Reference)',
			icon: 'ti ti-chart-dots-3',
			action: addReferencedVisualModuleLayer,
		}, {
			text: 'Scene',
			icon: 'ti ti-memory',
			action: () => addMediaLayer('scene'),
		}, {
			text: desktopAvailable() ? 'VOICEVOX' : 'VOICEVOX (使用不可)',
			icon: 'ti ti-microphone',
			action: () => {
				if (!desktopAvailable()) {
					ui.alert({ type: 'error', text: 'VOICEVOXレイヤーの追加はWeb版では対応していません。Electron版を使用する必要があります。' });
					return;
				}
				const layer = createVoicevoxTimelineLayer(Math.max(0, time.value));
				stateManager.commit('addTimelineLayer', { sceneId: scene.id, layer });
				selectLayer(layer);
			},
		}], ev.currentTarget ?? ev.target);
	}

	return { addClip, changeClipSource, showAddLayerMenu, readLayerMediaDurations };
}
