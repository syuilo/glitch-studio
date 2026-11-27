<template>
<div :class="$style.root">
	<div class="_spacer">
		<div v-for="value in stateManager.undoStack.value.toReversed()">
			<div>{{ value.label }}</div>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { watch, useTemplateRef, ref, onMounted } from 'vue';
import type { WorkspacePanel } from '@/workspace.ts';
import { useProjectSession } from '@/project-session.ts';
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
	overflow-y: scroll;
}
</style>
