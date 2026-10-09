import { findTimelineLayerLocation } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import type { Ref } from 'vue';
import type { TimelineLayer, TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { ProjectState, AppStateChange } from '@/Project.ts';
import type { COMMAND_DEFS } from '@/commands.ts';
import type { MenuItem } from '@/types/menu.ts';
import type { UndoRedo } from './undo-redo.ts';
import type { TimelineSelection } from './timeline-selection.ts';
import type { TimelineClipSourceDurations } from './timeline-clip-media.ts';
import { duplicateTimelineLayers } from './timeline-group.ts';

type TimelineLayerActionsOptions = {
	stateManager: Pick<UndoRedo<ProjectState, AppStateChange, typeof COMMAND_DEFS>, 'state' | 'commit'>;
	scene: TimelineScene;
	selection: Ref<TimelineSelection>;
	isActive: () => boolean;
	readLayerMediaDurations: (layer: TimelineLayer) => Promise<TimelineClipSourceDurations | undefined>;
	selectLayer: (layer: TimelineLayer) => void;
	canGroup: () => boolean;
	groupSelection: () => void;
	focusTimeline: () => void;
	ui: Pick<typeof import('@/ui.ts'), 'contextMenu' | 'inputText' | 'alert'>;
};

export function createTimelineLayerActions(options: TimelineLayerActionsOptions) {
	const { stateManager, scene, selection, isActive, readLayerMediaDurations, selectLayer, canGroup, groupSelection, focusTimeline, ui } = options;

	function showMenu(event: PointerEvent, layer: TimelineLayer) {
		if (!isActive()) return;
		// 選択済みの行では複数選択を保持する。修飾キーを押していても右クリックで選択を解除しない。
		if (selection.value.kind !== 'layers' || !selection.value.ids.includes(layer.id)) selectLayer(layer);
		if (selection.value.kind !== 'layers') return;
		const ids = [...selection.value.ids];
		const menu: MenuItem[] = [{ text: 'Group', icon: 'ti ti-folder-symlink', disabled: !canGroup(), action: groupSelection }];
		if (ids.length === 1) menu.push({ text: 'Rename', icon: 'ti ti-edit', action: () => rename(ids[0]) });
		menu.push({ text: 'Duplicate', icon: 'ti ti-copy', action: () => duplicate(ids) }, {
			text: 'Delete', icon: 'ti ti-trash', danger: true, action: () => remove(ids),
		});
		ui.contextMenu(menu, event);
	}

	async function rename(layerId: string) {
		const layer = findTimelineLayerLocation(scene.layers, layerId)?.layer;
		if (!isActive() || !layer) return;
		const { canceled, result: name } = await ui.inputText({ title: 'Rename Layer', default: layer.name, placeholder: layer.name });
		if (canceled || name == null || !isActive() || !findTimelineLayerLocation(scene.layers, layerId)) return;
		stateManager.commit('renameTimelineLayer', { sceneId: scene.id, layerId, name });
	}

	async function duplicate(ids: string[]) {
		if (!isActive()) return;
		// 親グループと子が両方選択されていても、子を二重に複製しない。
		// 全対象を一緒に複製し、選択レイヤー間の音声参照も複製先へ付け替える。
		const locations = ids.map(id => findTimelineLayerLocation(scene.layers, id));
		if (locations.some(location => !location)) return;
		const sources = locations.filter(location => !location!.ancestors.some(ancestor => ids.includes(ancestor.id))).map(location => location!.layer);
		const layers = duplicateTimelineLayers(sources);
		const initialLayers = scene.layers;
		try {
			const durations = await Promise.all(layers.map(readLayerMediaDurations));
			// 素材読み込み中に階層が編集された場合は、古い所属・順序で複製を挿入しない。
			if (!isActive() || scene.layers !== initialLayers) return;
			stateManager.commit('duplicateTimelineLayers', { sceneId: scene.id,
				layers: layers.map((layer, index) => ({ layer, sourceLayerId: sources[index].id })),
				sourceDurationsMs: Object.assign(Object.create(null), ...durations),
			});
			selection.value = { kind: 'layers', ids: layers.map(layer => layer.id) };
			focusTimeline();
		} catch (error) {
			ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
		}
	}

	function remove(ids: string[]) {
		if (!isActive() || ids.some(id => !findTimelineLayerLocation(scene.layers, id))) return;
		stateManager.commit('removeTimelineLayers', { sceneId: scene.id, layerIds: ids });
		selection.value = { kind: 'layers', ids: [] };
		focusTimeline();
	}

	return { showMenu };
}
