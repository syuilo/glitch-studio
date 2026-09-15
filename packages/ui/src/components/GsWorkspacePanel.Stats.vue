<template>
<GsWorkspacePanel :panel="panel">
	<template #header>
		<i class="ti ti-activity"></i><span style="margin-left: 8px;">Stats</span>
	</template>

	<div :class="$style.root">
		<GsRenderingStats/>
	</div>
</GsWorkspacePanel>
</template>

<script lang="ts" setup>
import { watch, useTemplateRef, ref, onMounted } from 'vue';
import GsWorkspacePanel from './GsWorkspacePanel.vue';
import type { WorkspacePanel } from '@/types/workspace.ts';
import { i18n } from '@/i18n.ts';
import GsRenderingStats from '@/components/GsRenderingStats.vue';

const props = defineProps<{
	panel: WorkspacePanel;
}>();
</script>

<style module lang="scss">
.root {
	height: 100%;
	padding: 2px 12px 12px 12px;
	box-sizing: border-box;
}
</style>
