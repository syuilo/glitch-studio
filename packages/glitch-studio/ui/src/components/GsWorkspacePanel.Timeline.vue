<template>
<div :class="$style.root">
	<GsTimeline v-if="activeScene" :key="activeScene.id" :sceneId="activeScene.id" :inspectorPanelTarget="inspectorPanelTarget" @revealDetails="revealDetails" @revealAssets="revealAssets">
		<GsButton icon="ti ti-chevron-down" @click="showSceneSelectMenu">{{ activeScene.name }}</GsButton>
		<GsButton iconOnly icon="ti ti-dots" @click="showSceneMenu"/>
	</GsTimeline>
	<div v-else>{{ i18n.ts._Timeline.CreateScene }}</div>
</div>
</template>

<script lang="ts" setup>
import { flattenTimelineLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { computed, ref, watch, inject } from 'vue';
import { genId } from '@gs/shared/utility/id.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import GsButton from './common/GsButton.vue';
import GsSceneResolutionDialog from './GsSceneResolutionDialog.vue';
import type { WorkspacePanel } from '@/workspace.ts';
import type { MenuItem } from '@/types/menu.ts';
import { i18n } from '@/i18n.ts';
import { duplicateTimelineLayers } from '@/utility/timeline-container.ts';
import { workspaceControllerKey } from '@/WorkspaceController.ts';
import { appContext } from '@/app.ts';
import GsTimeline from '@/components/GsTimeline.vue';
import * as ui from '@/ui.ts';

const { activeSceneId, activeScene } = appContext;
const { stateManager } = appContext.projectContext;

const props = defineProps<{
	panel: WorkspacePanel;
}>();

const workspaceController = inject(workspaceControllerKey)!;
const revealRequest = () => ({ contentType: 'timelineInspectorPanel' as const, sourcePanelId: props.panel.id });
const inspectorPanelTarget = computed(() => {
	const id = workspaceController.findVisiblePanel(revealRequest());
	return id == null ? null : workspaceController.panelTargets.get(id) ?? null;
});

function revealDetails() {
	workspaceController.revealPanel(revealRequest());
}

function revealAssets() {
	workspaceController.revealPanel({ contentType: 'assets', sourcePanelId: props.panel.id });
}

const references = computed(() => stateManager.state.timelineScenes.value.filter(scene => flattenTimelineLayers(scene.layers).some(layer => layer.layerType === 'scene' && layer.clips.some(clip => clip.sceneId === activeSceneId.value))));

function createScene() {
	const id = genId();
	stateManager.commit('addScene', {
		id,
		name: `SN${stateManager.state.timelineScenes.value.length + 1}`,
		resolution: { mode: 'project' },
		layers: [],
	});
	activeSceneId.value = id;
}

function duplicateScene() {
	if (activeScene.value == null) return;
	const scene = deepClone(activeScene.value);
	scene.id = genId();
	scene.name += ' (copy)';
	// 内部レイヤーは独立させ、別Sceneへの参照は通常のレイヤー複製と同じく共有する。
	scene.layers = duplicateTimelineLayers(scene.layers);
	stateManager.commit('addScene', scene);
	activeSceneId.value = scene.id;
}

async function renameScene() {
	const scene = activeScene.value;
	if (scene == null) return;

	const { canceled, result: name } = await ui.inputText({
		title: i18n.ts._Timeline.RenameScene,
		placeholder: scene.name,
		default: scene.name,
	});
	if (canceled || name == null) return;

	stateManager.commit('renameScene', { sceneId: scene.id, name });
}

function removeScene() {
	if (activeSceneId.value != null && references.value.length === 0) stateManager.commit('removeScene', { sceneId: activeSceneId.value });
}

function showSceneSelectMenu(ev: PointerEvent) {
	const menuItems = stateManager.state.timelineScenes.value.map(scene => ({
		text: scene.name,
		icon: 'ti ti-memory',
		active: activeSceneId.value === scene.id,
		action: () => { activeSceneId.value = scene.id; },
	})) satisfies MenuItem[];
	ui.popupMenu([...menuItems, {
		type: 'divider',
	}, {
		text: i18n.ts._Timeline.NewScene,
		icon: 'ti ti-plus',
		action: createScene,
	}], ev.currentTarget ?? ev.target);
}

function showSceneMenu(ev: PointerEvent) {
	const menuItems: MenuItem[] = [{
		text: i18n.ts._Timeline.SceneResolution,
		icon: 'ti ti-dimensions',
		action: () => {
			if (activeSceneId.value == null) return;
			const { dispose } = ui.popup(GsSceneResolutionDialog, { sceneId: activeSceneId.value }, { closed: () => dispose() });
		},
	}, {
		text: i18n.ts._Timeline.RenameScene,
		icon: 'ti ti-edit',
		action: renameScene,
	}, {
		text: i18n.ts._Timeline.DuplicateScene,
		icon: 'ti ti-copy',
		action: duplicateScene,
	}, {
		text: i18n.ts._Timeline.RemoveScene,
		icon: 'ti ti-trash',
		disabled: references.value.length > 0,
		danger: true,
		action: removeScene,
	}];
	ui.popupMenu(menuItems, ev.currentTarget ?? ev.target);
}
</script>

<style module lang="scss">
.root {
	height: 100%;
}
</style>
