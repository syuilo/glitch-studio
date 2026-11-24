import { createNodesEffectDefinition } from './project-nodes-effect.ts';
import { isTimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { createTimelineClipTiming, getTimelineClipInsertionDuration } from '@gs/subsystems_timeline_shared/timing.ts';
import { createTimelineMediaClipTiming } from '@gs/subsystems_timeline_shared/media-timing.ts';
import { canReferenceScene } from '@gs/subsystems_timeline_shared/scenes.ts';
import { findTimelineEffectOutput } from '@gs/subsystems_timeline_shared/layers/effect/effect-layer.ts';
import { shapeDefinitions } from '@gs/subsystems_timeline_shared/layers/shape/shape.ts';
import { findTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import type { TimelineLayerRecipe } from '../commands/timeline-creation.ts';
import type { Ref } from 'vue';
import type { EffectChoice } from '@/utility/project-effects.ts';
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
	stateManager: Pick<UndoRedo<ProjectState, AppStateChange, typeof COMMAND_DEFS>, 'state' | 'commit' | 'execute'>;
	scene: TimelineScene;
	sceneLayers: Readonly<Ref<TimelineLayer[]>>;
	currentTime: Readonly<Ref<number>>;
	isActive: () => boolean;
	inspectMedia: (asset: Asset) => Promise<TimelineClipMediaInfo>;
	ui: Pick<typeof import('@/ui.ts'), 'select' | 'confirm' | 'popupMenu' | 'alert'> & {
		selectAsset: (options: Parameters<typeof import('@/ui.ts').selectAsset>[1]) => ReturnType<typeof import('@/ui.ts').selectAsset>;
	};
	pickEffect: (chosen: (definition: EffectChoice) => void) => void;
	desktopAvailable: () => boolean;
	selectLayer: (layer: TimelineLayer) => void;
	selectClip: (target: TimelineClipSelection) => void;
	addEmptyGroup: () => void;
	seek: (timeMs: number) => void;
	reportError: (error: unknown) => void;
};

/** 素材・Sceneの選択、クリップの追加・差し替え、レイヤー追加をCommandへ繋ぐ。DOMとピッカーの寿命は呼び出し側が所有する。 */
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
				const result = await ui.confirm({
					type: 'warning',
					title: asset.name,
					text: media.audioError,
					actions: [
						{ id: 'add-without-audio', text: i18n.ts._Timeline.AddWithoutAudio, primary: true, isAutofocus: true },
						{ id: 'cancel', text: i18n.ts.Cancel, isCancel: true },
					],
					canCancel: true,
				});
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
			...(type === 'audio' || type === 'video' ? createTimelineMediaClipTiming(startMs, durationMs) : createTimelineClipTiming(startMs, durationMs)),
			...(source?.kind === 'scene' ? { sceneId: source.scene.id } : source?.kind === 'asset' ? { assetId: source.asset.id } : {}),
			...(type === 'video' ? { audioEnabled: source?.kind === 'asset' && !!source.media?.audioAvailable, videoEnabled: true } : {}),
		};
		try {
			const created = await stateManager.execute('createTimelineClip', {
				sceneId: scene.id,
				layerId: layer.id,
				clip,
			});
			selectClip({ layerId: created.layerId, clipId: created.clipId });
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
			await stateManager.execute('setTimelineClipSource', {
				sceneId: scene.id,
				...entry.target,
				...(source.kind === 'scene' ? {
					referencedSceneId: source.scene.id,
				} : {
					assetId: source.asset.id,
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

	async function addMediaLayer(layerType: 'image' | 'video' | 'audio' | 'scene') {
		const source = await chooseClipSource(layerType);
		if (source == null || !isActive()) return;
		const startMs = Math.max(0, time.value);
		const durationMs = source.kind === 'asset' ? source.media?.durationMs ?? 5000 : 5000;
		const clip = {
			...(layerType === 'audio' || layerType === 'video' ? createTimelineMediaClipTiming(startMs, durationMs) : createTimelineClipTiming(startMs, durationMs)),
			...(source.kind === 'asset' ? { assetId: source.asset.id } : { sceneId: source.scene.id }),
			...(layerType === 'video' ? { audioEnabled: source.kind === 'asset' && source.media?.audioAvailable === true, videoEnabled: true } : {}),
		};
		try {
			const created = await stateManager.execute('createTimelineLayer', {
				sceneId: scene.id,
				layer: { layerType, name: source.kind === 'asset' ? source.asset.name : source.scene.name },
				clips: [clip],
			});
			const layer = findTimelineLayer(scene.layers, created.layerId);
			if (layer != null && !isTimelineContainerLayer(layer)) selectClip({ layerId: layer.id, clipId: layer.clips[0].id });
		} catch (error) { reportError(error); }
	}

	function addLayer(recipe: TimelineLayerRecipe, withClip = true, seekAfter = false) {
		const startMs = Math.max(0, time.value);
		const created = stateManager.commit('createTimelineLayer', {
			sceneId: scene.id, layer: recipe,
			clips: withClip ? [createTimelineClipTiming(startMs, 5000)] : [],
		});
		const layer = findTimelineLayer(scene.layers, created.layerId);
		if (layer == null) throw new Error('Created timeline layer not found');
		selectLayer(layer);
		if (seekAfter) seek(startMs);
	}

	async function addReferencedNodesEffectLayer() {
		const initialLayers = sceneLayers.value;
		const { canceled, result: id } = await ui.select({ title: i18n.ts._Timeline.SelectNodesEffect, items: stateManager.state.nodesEffects.value.filter(({ definition }) => findTimelineEffectOutput(definition) != null).map(nodesEffect => ({ label: nodesEffect.name, value: nodesEffect.id })) });
		const nodesEffect = stateManager.state.nodesEffects.value.find(nodesEffect => nodesEffect.id === id);
		if (canceled || nodesEffect == null || !isActive() || sceneLayers.value !== initialLayers) return;
		addLayer({ layerType: 'effect', effectSource: { type: 'nodesEffectReference', id: nodesEffect.id } });
	}

	function showAddEffectLayerMenu() {
		pickEffect(definition => {
			if (isActive()) addLayer({ layerType: 'effect', effectSource: definition.effectSource }, true, true);
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
			action: () => addLayer({ layerType: 'text' }, true, true),
		}, {
			type: 'parent',
			text: i18n.ts.Shape,
			icon: 'ti ti-shape',
			children: (Object.keys(shapeDefinitions) as ShapeType[]).map(type => ({
				text: shapeDefinitions[type].label,
				icon: type === 'ellipse' ? 'ti ti-circle' : 'ti ti-rectangle',
				action: () => addLayer({ layerType: 'shape', shapeType: type }, true, true),
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
			text: i18n.ts._Timeline.InlineNodesEffect,
			icon: 'ti ti-binary-tree-2',
			action: () => addLayer({ layerType: 'effect', effectSource: { type: 'inlineNodesEffect', nodesEffect: createNodesEffectDefinition() } }, true, true),
		}, {
			id: 'referenceNodesEffect',
			text: i18n.ts._Timeline.ReferenceNodesEffect,
			icon: 'ti ti-binary-tree-2',
			action: addReferencedNodesEffectLayer,
		}, {
			text: desktopAvailable() ? 'VOICEVOX' : i18n.ts._Timeline.VoicevoxUnavailable,
			icon: 'ti ti-microphone',
			action: () => {
				if (!desktopAvailable()) {
					ui.alert({ type: 'error', text: i18n.ts._Timeline.VoicevoxDesktopOnly });
					return;
				}
				addLayer({ layerType: 'voicevox' });
			},
		}, {
			type: 'divider',
		}, {
			text: i18n.ts.Scene,
			icon: 'ti ti-memory',
			action: () => addMediaLayer('scene'),
		}, {
			id: 'folder',
			text: i18n.ts.Folder,
			icon: 'ti ti-folder',
			action: () => {
				addLayer({ layerType: 'folder' }, false);
			},
		}, {
			id: 'parameterContainer',
			text: i18n.ts.ParameterContainer,
			icon: 'ti ti-adjustments-horizontal',
			action: () => {
				addLayer({ layerType: 'parameterContainer' }, false);
			},
		}, {
			text: i18n.ts.Group,
			icon: 'ti ti-stack-2',
			action: addEmptyGroup,
		}, {
			text: i18n.ts.Transform,
			icon: 'ti ti-gizmo',
			action: () => addLayer({ layerType: 'transform' }, false),
		}, {
			id: 'camera',
			text: i18n.ts.Camera,
			icon: 'ti ti-camera',
			action: () => addLayer({ layerType: 'camera' }, true, true),
		}], ev.currentTarget ?? ev.target);
	}

	return {
		addClip,
		changeClipSource,
		showAddLayerMenu,
		readLayerMediaDurations,
	};
}
