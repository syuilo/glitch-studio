<template>
<div :class="$style.root">
	<GsTimeline v-if="activeScene" :key="activeScene.id" :sceneId="activeScene.id">
		<GsButton small @click="showSceneMenu">Scene: {{ activeScene.name }} <i class="ti ti-chevron-down"></i></GsButton>
	</GsTimeline>
	<div v-else>Create a scene to start editing.</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { genId } from '@glitch/shared/utility/id.ts';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import GsButton from './common/GsButton.vue';
import type { WorkspacePanel } from '@/workspace.ts';
import type { MenuItem } from '@/types/menu.ts';
import GsTimeline from '@/components/GsTimeline.vue';
import { appStateManager, activeSceneId, activeScene } from '@/app.ts';
import * as ui from '@/ui.ts';

defineProps<{
	panel: WorkspacePanel;
}>();

const name = ref('');
watch(() => activeScene.value?.name, value => { name.value = value ?? ''; }, { immediate: true });
const references = computed(() => appStateManager.state.timelineScenes.value.filter(scene => scene.layers.some(layer => layer.layerType === 'scene' && layer.sceneId === activeSceneId.value)));

function createScene() {
	const id = genId();
	appStateManager.commit('addScene', { id, name: `Scene ${appStateManager.state.timelineScenes.value.length + 1}`, layers: [] });
	activeSceneId.value = id;
}

function duplicateScene() {
	if (activeScene.value == null) return;
	const scene = deepClone(activeScene.value);
	scene.id = genId();
	scene.name += ' (copy)';
	// 内部レイヤーは独立させ、別Sceneへの参照は通常のレイヤー複製と同じく共有する。
	for (const layer of scene.layers) layer.id = genId();
	appStateManager.commit('addScene', scene);
	activeSceneId.value = scene.id;
}

function renameScene() {
	if (activeSceneId.value != null && name.value.trim()) appStateManager.commit('renameScene', { sceneId: activeSceneId.value, name: name.value.trim() });
}

function removeScene() {
	if (activeSceneId.value != null && references.value.length === 0) appStateManager.commit('removeScene', { sceneId: activeSceneId.value });
}

function showSceneMenu(ev: PointerEvent) {
	const menuItems = appStateManager.state.timelineScenes.value.map(scene => ({
		text: scene.name,
		icon: 'ti ti-layout-dashboard',
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
</script>

<style module lang="scss">
.root {
	height: 100%;
}
</style>
