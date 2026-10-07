<template>
<div :class="$style.root">
	<div ref="target"></div>
</div>
</template>

<script lang="ts" setup>
import { inject, useTemplateRef, onMounted, onBeforeUnmount } from 'vue';
import type { WorkspacePanel } from '@/workspace.ts';
import { workspaceControllerKey } from '@/WorkspaceController.ts';

const props = defineProps<{
	panel: WorkspacePanel;
}>();

const workspaceController = inject(workspaceControllerKey)!;
const target = useTemplateRef('target');
onMounted(() => {
	if (target.value) workspaceController.panelTargets.set(props.panel.id, target.value);
});
onBeforeUnmount(() => {
	workspaceController.panelTargets.delete(props.panel.id);
});
</script>

<style module lang="scss">
.root {
	height: 100%;
	overflow-y: auto;
}
</style>
