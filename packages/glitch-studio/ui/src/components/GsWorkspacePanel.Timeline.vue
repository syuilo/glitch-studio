<template>
<div :class="$style.root">
	<GsTimeline v-if="activeScene" :key="activeScene.id" :sceneId="activeScene.id" :subPanelTarget="subPanelTarget" @revealDetails="revealDetails">
		<GsButton small @click="showSceneSelectMenu">{{ activeScene.name }} <i class="ti ti-chevron-down"></i></GsButton>
		<GsButton small iconOnly @click="showSceneMenu"><i class="ti ti-dots"></i></GsButton>
	</GsTimeline>
	<div v-else>Create a scene to start editing.</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch, inject } from 'vue';
import { genId } from '@gs/shared/utility/id.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import GsButton from './common/GsButton.vue';
import GsSceneResolutionDialog from './GsSceneResolutionDialog.vue';
import type { WorkspacePanel } from '@/workspace.ts';
import type { MenuItem } from '@/types/menu.ts';
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
const revealRequest = () => ({ contentType: 'timelineSubPanel' as const, sourcePanelId: props.panel.id });
const subPanelTarget = computed(() => {
	const id = workspaceController.findVisiblePanel(revealRequest());
	return id == null ? null : workspaceController.panelTargets.get(id) ?? null;
});

function revealDetails() {
	workspaceController.revealPanel(revealRequest());
}

const references = computed(() => stateManager.state.timelineScenes.value.filter(scene => scene.layers.some(layer => layer.layerType === 'scene' && layer.clips.some(clip => clip.sceneId === activeSceneId.value))));

function createScene() {
	const id = genId();
	stateManager.commit('addScene', { id, name: `Scene ${stateManager.state.timelineScenes.value.length + 1}`, resolution: { mode: 'project' }, layers: [] });
	activeSceneId.value = id;
}

function duplicateScene() {
	if (activeScene.value == null) return;
	const scene = deepClone(activeScene.value);
	scene.id = genId();
	scene.name += ' (copy)';
	// 内部レイヤーは独立させ、別Sceneへの参照は通常のレイヤー複製と同じく共有する。
	for (const layer of scene.layers) layer.id = genId();
	stateManager.commit('addScene', scene);
	activeSceneId.value = scene.id;
}

async function renameScene() {
	const scene = activeScene.value;
	if (scene == null) return;

	const { canceled, result: name } = await ui.inputText({
		title: 'Rename Scene',
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
		text: 'New Scene',
		icon: 'ti ti-plus',
		action: createScene,
	}], ev.currentTarget ?? ev.target);
}

function showSceneMenu(ev: PointerEvent) {
	const menuItems: MenuItem[] = [{
		text: 'Scene resolution',
		icon: 'ti ti-dimensions',
		action: () => {
			if (activeSceneId.value == null) return;
			const { dispose } = ui.popup(GsSceneResolutionDialog, { sceneId: activeSceneId.value }, { closed: () => dispose() });
		},
	}, {
		text: 'Rename Scene',
		icon: 'ti ti-edit',
		action: renameScene,
	}, {
		text: 'Duplicate Scene',
		icon: 'ti ti-copy',
		action: duplicateScene,
	}, {
		text: 'Remove Scene',
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
