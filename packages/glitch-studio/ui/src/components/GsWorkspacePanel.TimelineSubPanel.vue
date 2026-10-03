<template>
<div :class="$style.root">
	<div id="timelineSubPanelTeleportTarget"></div>
</div>
</template>

<script lang="ts" setup>
import { watch, useTemplateRef, ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import type { WorkspacePanel } from '@/workspace.ts';
import { i18n } from '@/i18n.ts';
import { timelineSubPanelTeleportTargetAvailable } from '@/app.ts';

const props = defineProps<{
	panel: WorkspacePanel;
}>();

onMounted(() => {
	//nextTick(() => {
	timelineSubPanelTeleportTargetAvailable.value = true;
	//});
});

onBeforeUnmount(() => {
	timelineSubPanelTeleportTargetAvailable.value = false;
});
</script>

<style module lang="scss">
.root {
	height: 100%;
	overflow-y: auto;
}
</style>
