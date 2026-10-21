import { isTimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { createTimelineClipTiming, getTimelineClipInsertionDuration } from '@gs/subsystems_timeline_shared/timing.ts';
import { createTimelineMediaClipTiming } from '@gs/subsystems_timeline_shared/media-timing.ts';
import { canReferenceScene } from '@gs/subsystems_timeline_shared/scenes.ts';
import { shapeDefinitions } from '@gs/subsystems_timeline_shared/layers/shape/shape.ts';
import { timelineAudioParamDefs } from '@gs/subsystems_timeline_shared/timeline-audio.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { createTransformTimelineLayer } from './transform-timeline-layer.ts';
import { createEffectTimelineLayer } from './effect-timeline-layer.ts';
import { createShapeTimelineLayer } from './shape-timeline-layer.ts';
import { createCameraTimelineLayer } from './camera-timeline-layer.ts';
import { createVoicevoxTimelineLayer } from './voicevox-timeline-layer.ts';
import { createTextTimelineLayer } from './text-timeline-layer.ts';
import { createInlineVisualModuleLayer } from './inline-visual-module-layer.ts';
import { createTimelineAssetLayer } from './timeline-asset-layer.ts';
import type { Ref } from 'vue';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { TimelineLayer, TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { ShapeType } from '@gs/subsystems_timeline_shared/layers/shape/shape.ts';
import type { ProjectState, AppStateChange } from '@/Project.ts';
import type { COMMAND_DEFS } from '@/commands.ts';
import type { UndoRedo } from './undo-redo.ts';
import type { TimelineClipSelection } from './timeline-selection.ts';
import type { TimelineClipMediaInfo, TimelineClipSourceDurations } from './timeline-clip-media.ts';
import type { Asset } from '@gs/shared/types.ts';
import { i18n } from '@/i18n.ts';

type TimelineSourceActionsOptions = {
	stateManager: Pick<UndoRedo<ProjectState, AppStateChange, typeof COMMAND_DEFS>, 'state' | 'commit'>;
	scene: TimelineScene;
	sceneLayers: Readonly<Ref<TimelineLayer[]>>;
	currentTime: Readonly<Ref<number>>;
	isActive: () => boolean;
	inspectMedia: (asset: Asset) => Promise<TimelineClipMediaInfo>;
	ui: Pick<typeof import('@/ui.ts'), 'select' | 'selectAsset' | 'confirm' | 'popupMenu' | 'alert'>;
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
	const {
		stateManager,
		scene,
		sceneLayers,
		currentTime: time,
		isActive,
		inspectMedia,
		ui,
		pickEffect,
		desktopAvailable,
		selectLayer,
		selectClip,
		addEmptyGroup,
		seek,
		reportError,
	} = options;
	const availableScenes = () => stateManager.state.timelineScenes.value.filter(candidate => canReferenceScene(stateManager.state.timelineScenes.value, scene.id, candidate.id));

	type ClipSource = { kind: 'asset'; asset: Asset; media?: TimelineClipMediaInfo | null } | { kind: 'scene'; scene: TimelineScene };

	function resolveClip(target: TimelineClipSelection) {
		const layer = sceneLayers.value.find(layer => layer.id === target.layerId);
		if (layer == null || isTimelineContainerLayer(layer)) return null;
		const clip = layer.clips.find(clip => clip.id === target.clipId);
		return clip ? { layer, clip, target } : null;
	}

	async function chooseClipSource(layerType: 'image' | 'video' | 'audio' | 'scene'): Promise<ClipSource | null> {
		const initialLayers = sceneLayers.value;
		if (layerType === 'scene') {
			const { canceled, result: id } = await ui.select({ title: i18n.ts._Timeline.SelectScene, items: availableScenes().map(scene => ({ label: scene.name, value: scene.id })) });
			const selected = availableScenes().find(scene => scene.id === id);
			return canceled || !selected || !isActive() || sceneLayers.value !== initialLayers ? null : { kind: 'scene', scene: selected };
		}
		const [selectedAsset] = await ui.selectAsset({ multiple: false, mimeType: layerType + '/*' });
		// ピッカーはAssetのコピーを返す。選択中のインポートも許容しつつ、
		// 削除済みのAssetや古いファイル入力を使わないよう現在のプロジェクトから解決し直す。
		const asset = stateManager.state.assets.value.find(asset => asset.id === selectedAsset?.id);
		if (asset == null || !asset.fileDataType.startsWith(layerType + '/') || !isActive() || sceneLayers.value !== initialLayers) return null;
		const fileSource = asset.fileData;
		try {
			const media = layerType === 'image' ? null : await inspectMedia(asset);
			if (!isActive() || sceneLayers.value !== initialLayers || !stateManager.state.assets.value.includes(asset) || asset.fileData !== fileSource) return null;
			if (media?.audioError) {
				const result = await ui.confirm({ type: 'warning', title: asset.name, text: media.audioError, okText: i18n.ts._Timeline.AddWithoutAudio });
				if (result.canceled || !isActive() || sceneLayers.value !== initialLayers || !stateManager.state.assets.value.includes(asset) || asset.fileData !== fileSource) return null;
			}
			return { kind: 'asset', asset, media };
		} catch (error) { reportError(error); return null; }
	}

	async function addClip(layer: TimelineLayer, startMs: number) {
		if (isTimelineContainerLayer(layer)) return;
		startMs = Math.round(startMs);
		if (getTimelineClipInsertionDuration(layer.clips, startMs) <= 0) return;
		const type = layer.layerType;
		const source = type === 'image' || type === 'video' || type === 'audio' || type === 'scene' ? await chooseClipSource(type) : null;
		if (!isActive() || !sceneLayers.value.includes(layer)) return;
		if ((type === 'image' || type === 'video' || type === 'audio' || type === 'scene') && !source) return;
		// ピッカー待機中にも他のクリップが動くので、追加直前の空きを使う。
		const sourceDurationMs = source?.kind === 'asset' ? source.media?.durationMs : null;
		const durationMs = getTimelineClipInsertionDuration(layer.clips, startMs, sourceDurationMs ?? 5000);
		if (durationMs <= 0) return;
		const clip = {
			id: genId(),
			...(type === 'audio' || type === 'video' ? createTimelineMediaClipTiming(startMs, durationMs) : createTimelineClipTiming(startMs, durationMs)),
			...(source?.kind === 'scene' ? { sceneId: source.scene.id } : source?.kind === 'asset' ? { assetId: source.asset.id } : {}),
			...(type === 'video' ? { audioEnabled: source?.kind === 'asset' && !!source.media?.audioAvailable, videoEnabled: true } : {}),
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
		if (source.kind === 'asset' && 'assetId' in entry.clip && entry.clip.assetId === source.asset.id && !('sourceTimeMs' in entry.clip)) return;
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

	async function readLayerMediaDurations(layer: TimelineLayer): Promise<TimelineClipSourceDurations | null> {
		if (isTimelineContainerLayer(layer)) return Object.assign(Object.create(null), ...await Promise.all(layer.layers.map(readLayerMediaDurations)));
		if (layer.layerType !== 'audio' && layer.layerType !== 'video') return null;
		const sources = layer.clips.map(clip => {
			const asset = stateManager.state.assets.value.find(asset => asset.id === clip.assetId);
			if (!asset) throw new Error(i18n.ts._TimelineClip.MissingMedia);
			return { clipId: clip.id, asset, fileSource: asset.fileData };
		});
		const durations = await Promise.all(sources.map(async ({ clipId, asset }) => [clipId, (await inspectMedia(asset)).durationMs] as const));
		if (sources.some(({ asset, fileSource }) => !stateManager.state.assets.value.includes(asset) || asset.fileData !== fileSource)) throw new Error('Media changed during loading');
		return { [layer.id]: Object.fromEntries(durations) };
	}

	function initialCompositingParameters() {
		return deepClone(Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, def.defaultValue]))) as import('@gs/subsystems_timeline_shared/types.ts').TimelineImageLayer['compositingParamValues'];
	}

	async function addMediaLayer(layerType: 'image' | 'video' | 'audio' | 'scene') {
		const source = await chooseClipSource(layerType);
		if (!source || !isActive()) return;
		const sourceDurationMs = source.kind === 'asset' ? source.media?.durationMs : null;
		if (source.kind === 'asset') {
			try {
				const layer = createTimelineAssetLayer(source.asset, time.value, source.media ?? null);
				if (layer == null) return;
				const clip = layer.clips[0];
				stateManager.commit('addTimelineLayer', {
					sceneId: scene.id,
					layer,
					sourceDurationsMs: sourceDurationMs == null ? null : { [layer.id]: { [clip.id]: sourceDurationMs } },
				});
				selectClip({ layerId: layer.id, clipId: clip.id });
			} catch (error) { reportError(error); }
			return;
		}
		const clip = { id: genId(), ...createTimelineClipTiming(Math.max(0, time.value), 5000) };
		const base = { id: genId(), name: source.scene.name, automationGraphs: [], isDisabled: false, color: null };
		const audioParamValues = { volume: deepClone(timelineAudioParamDefs.volume.defaultValue) };
		const compositingParamValues = initialCompositingParameters();
		const layer: TimelineLayer = { ...base, layerType: 'scene', clips: [{ ...clip, sceneId: source.scene.id }], audioParamValues, compositingParamValues, mask: null, coordinateSpace: 'screen', forceDisableMotionBlur: false };
		stateManager.commit('addTimelineLayer', { sceneId: scene.id, layer });
		selectClip({ layerId: layer.id, clipId: clip.id });
	}

	async function addReferencedVisualModuleLayer() {
		const initialLayers = sceneLayers.value;
		const { canceled, result: id } = await ui.select({ title: i18n.ts._Timeline.SelectVisualModule, items: stateManager.state.visualModules.value.map(visualModule => ({ label: visualModule.name, value: visualModule.id })) });
		const visualModule = stateManager.state.visualModules.value.find(visualModule => visualModule.id === id);
		if (canceled || !visualModule || !isActive() || sceneLayers.value !== initialLayers) return;
		const layer: TimelineLayer = {
			id: genId(),
			name: visualModule.name,
			layerType: 'visualModule',
			transformTarget: 'image',
			mask: null,
			coordinateSpace: 'screen',
			forceDisableMotionBlur: false,
			isDisabled: false,
			color: null,
			visualModuleId: visualModule.id,
			clips: [{ id: genId(), ...createTimelineClipTiming(Math.max(0, time.value), 5000) }],
			visualModuleParamValues: {},
			compositingParamValues: initialCompositingParameters(),
			automationGraphs: [],
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
			text: i18n.ts.Effect,
			icon: 'ti ti-sparkles',
			action: showAddEffectLayerMenu,
		}, {
			text: i18n.ts.Text,
			icon: 'ti ti-typography',
			action: () => {
				const layer = createTextTimelineLayer(Math.max(0, time.value));
				stateManager.commit('addTimelineLayer', { sceneId: scene.id, layer });
				selectLayer(layer);
				seek(layer.clips[0].startMs);
			},
		}, {
			type: 'parent',
			text: i18n.ts.Shape,
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
			text: i18n.ts.Image,
			icon: 'ti ti-photo',
			action: () => addMediaLayer('image'),
		}, {
			id: 'video',
			text: i18n.ts.Video,
			icon: 'ti ti-video',
			action: () => addMediaLayer('video'),
		}, {
			id: 'audio',
			text: i18n.ts.Audio,
			icon: 'ti ti-music',
			action: () => addMediaLayer('audio'),
		}, {
			text: i18n.ts._Timeline.InlineVisualModule,
			icon: 'ti ti-chart-dots-3',
			action: () => {
				const layer = createInlineVisualModuleLayer(Math.max(0, time.value));
				stateManager.commit('addTimelineLayer', { sceneId: scene.id, layer });
				selectLayer(layer);
				seek(layer.clips[0].startMs);
			},
		}, {
			id: 'referenceVisualModule',
			text: i18n.ts._Timeline.ReferenceVisualModule,
			icon: 'ti ti-chart-dots-3',
			action: addReferencedVisualModuleLayer,
		}, {
			text: desktopAvailable() ? 'VOICEVOX' : i18n.ts._Timeline.VoicevoxUnavailable,
			icon: 'ti ti-microphone',
			action: () => {
				if (!desktopAvailable()) {
					ui.alert({ type: 'error', text: i18n.ts._Timeline.VoicevoxDesktopOnly });
					return;
				}
				const layer = createVoicevoxTimelineLayer(Math.max(0, time.value));
				stateManager.commit('addTimelineLayer', { sceneId: scene.id, layer });
				selectLayer(layer);
			},
		}, {
			type: 'divider',
		}, {
			text: i18n.ts.Scene,
			icon: 'ti ti-memory',
			action: () => addMediaLayer('scene'),
		}, {
			text: i18n.ts.Group,
			icon: 'ti ti-folder',
			action: addEmptyGroup,
		}, {
			text: i18n.ts.Transform,
			icon: 'ti ti-gizmo',
			action: () => {
				const layer = createTransformTimelineLayer();
				stateManager.commit('addTimelineLayer', { sceneId: scene.id, layer });
				selectLayer(layer);
			},
		}, {
			id: 'camera',
			text: i18n.ts.Camera,
			icon: 'ti ti-camera',
			action: () => {
				const layer = createCameraTimelineLayer(Math.max(0, time.value));
				stateManager.commit('addTimelineLayer', { sceneId: scene.id, layer });
				selectLayer(layer);
				seek(layer.clips[0].startMs);
			},
		}], ev.currentTarget ?? ev.target);
	}

	return { addClip, changeClipSource, showAddLayerMenu, readLayerMediaDurations };
}
