<template>
<div :class="$style.root" class="_gaps">
	<GsInput v-model="projectName">
		<template #label>Project name</template>
	</GsInput>
	<GsTextarea v-model="projectDescription">
		<template #label>Description</template>
	</GsTextarea>
	<GsInput v-model="projectAuthor">
		<template #label>Author</template>
	</GsInput>
</div>
</template>

<script lang="ts" setup>
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
