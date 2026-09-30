<template>
<div :class="$style.root">
	<div :class="$style.toolbar">
		<GsSelect v-model="selectedSceneId" :items="sceneItems" small><template #label>Scene</template></GsSelect>
		<GsButton small @click="createScene">New scene</GsButton>
		<GsButton small :disabled="activeScene == null" @click="duplicateScene">Duplicate scene</GsButton>
		<GsInput v-if="activeScene" v-model="name" small><template #label>Name</template></GsInput>
		<GsButton small :disabled="activeScene == null || !name.trim() || name === activeScene.name" @click="renameScene">Rename</GsButton>
		<GsButton small danger :disabled="activeScene == null || references.length > 0" @click="removeScene">Delete scene</GsButton>
		<span v-if="references.length">Used by: {{ references.map(scene => scene.name).join(', ') }}</span>
	</div>
	<GsTimeline v-if="activeScene" :key="activeScene.id" :sceneId="activeScene.id" :class="$style.timeline"/>
	<div v-else>Create a scene to start editing.</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { genId } from '@glitch/shared/utility/id.ts';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import type { WorkspacePanel } from '@/workspace.ts';
import { appStateManager, activeSceneId, activeScene } from '@/app.ts';
import GsSelect from './common/GsSelect.vue';
import GsInput from './common/GsInput.vue';
import GsButton from './common/GsButton.vue';
import GsTimeline from '@/components/GsTimeline.vue';

defineProps<{
	panel: WorkspacePanel;
}>();

const selectedSceneId = computed({ get: () => activeSceneId.value ?? '', set: value => { activeSceneId.value = value || null; } });
const sceneItems = computed(() => appStateManager.state.timelineScenes.value.map(scene => ({ value: scene.id, label: scene.name })));
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
</script>

<style module lang="scss">
.root {
	height: 100%;
	display: flex;
	flex-direction: column;
}
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px; }
.timeline { flex: 1; min-height: 0; }
</style>
