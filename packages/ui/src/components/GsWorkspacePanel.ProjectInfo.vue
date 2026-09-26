<template>
<div :class="$style.root" class="_gaps">
	<GsInput v-model="projectInfo.name">
		<template #label>Project name</template>
	</GsInput>
	<GsTextarea v-model="projectInfo.description">
		<template #label>Description</template>
	</GsTextarea>
	<GsInput v-model="projectInfo.author">
		<template #label>Author</template>
	</GsInput>
</div>
</template>

<script lang="ts" setup>
import GsInput from './common/GsInput.vue';
import GsTextarea from './common/GsTextarea.vue';
import type { WorkspacePanel } from '@/workspace.ts';
import { projectInfo } from '@/app.ts';

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
