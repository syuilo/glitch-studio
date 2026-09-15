<template>
<GsWorkspacePanel :panel="panel">
	<template #header>
		<i class="ti ti-chart-dots-3"></i><span style="margin-left: 8px;">Node Editor</span>
	</template>

	<div :class="$style.root">
		<GsNodesEditor/>
	</div>
</GsWorkspacePanel>
</template>

<script lang="ts" setup>
import { watch, useTemplateRef, ref, onMounted } from 'vue';
import GsWorkspacePanel from './GsWorkspacePanel.vue';
import type { WorkspacePanel } from '@/types/workspace.ts';
import { i18n } from '@/i18n.ts';
import GsNodesEditor from '@/components/GsNodesEditor.vue';

const props = defineProps<{
	panel: WorkspacePanel;
}>();
</script>

<style module lang="scss">
.root {
	height: 100%;
}
</style>
