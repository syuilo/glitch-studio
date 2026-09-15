<template>
<GsWorkspacePanel :panel="panel">
	<template #header>
		<i class="ti ti-chart-column"></i><span style="margin-left: 8px;">Histogram</span>
	</template>

	<div :class="$style.root">
		<GsHistogram/>
	</div>
</GsWorkspacePanel>
</template>

<script lang="ts" setup>
import { watch, useTemplateRef, ref, onMounted } from 'vue';
import GsWorkspacePanel from './GsWorkspacePanel.vue';
import type { WorkspacePanel } from '@/workspace.ts';
import { i18n } from '@/i18n.ts';
import GsHistogram from '@/components/GsHistogram.vue';

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
