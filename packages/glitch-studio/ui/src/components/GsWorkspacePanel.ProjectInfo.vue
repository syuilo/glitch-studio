<template>
<div :class="$style.root" class="_gaps">
	<GsInput v-model="projectName" :placeholder="projectSession.projectDisplayName.value" large>
		<template #label>{{ i18n.ts._Project.Name }}</template>
	</GsInput>
	<GsTextarea v-model="projectDescription">
		<template #label>{{ i18n.ts._Project.Description }}</template>
	</GsTextarea>
	<GsInput v-model="projectAuthor" large>
		<template #label>{{ i18n.ts._Project.Author }}</template>
	</GsInput>
</div>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.ts';
import { useProjectSession } from '@/project-session.ts';
import GsInput from './common/GsInput.vue';
import GsTextarea from './common/GsTextarea.vue';
import type { WorkspacePanel } from '@/workspace.ts';
import { computed } from 'vue';

const projectSession = useProjectSession();

const { stateManager } = projectSession.projectContext;
const projectName = computed({
	get: () => stateManager.state.name.value,
	set: name => { stateManager.commit('setProjectName', { name }); },
});
const projectDescription = computed({
	get: () => stateManager.state.description.value,
	set: description => { stateManager.commit('setProjectDescription', { description }); },
});
const projectAuthor = computed({
	get: () => stateManager.state.author.value,
	set: author => { stateManager.commit('setProjectAuthor', { author }); },
});

defineProps<{ panel: WorkspacePanel }>();

</script>

<style module lang="scss">
.root {
	height: 100%;
	box-sizing: border-box;
	overflow: auto;
	padding: 16px;
}
</style>
