<template>
<div :class="$style.root" class="_gaps">
	<GsInput v-model="projectName" large>
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
import { appContext } from '@/app.ts';
import GsInput from './common/GsInput.vue';
import GsTextarea from './common/GsTextarea.vue';
import type { WorkspacePanel } from '@/workspace.ts';

const { name: projectName, description: projectDescription, author: projectAuthor } = appContext.projectContext.stateManager.state;

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
