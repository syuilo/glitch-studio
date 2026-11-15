<template>
<div :class="$style.root">
	<div v-for="value in stateManager.undoStack.value">
		<div>{{ value.label }}</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { useProjectSession } from '@/project-session.ts';
import { watch, useTemplateRef, ref, onMounted } from 'vue';
import type { WorkspacePanel } from '@/workspace.ts';
import { i18n } from '@/i18n.ts';

const projectSession = useProjectSession();

const { stateManager } = projectSession.projectContext;

const props = defineProps<{
	panel: WorkspacePanel;
}>();
</script>

<style module lang="scss">
.root {
	height: 100%;
}
</style>
