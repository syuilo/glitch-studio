<template>
<GsWorkspacePanel :panel="panel" :isStacked="isStacked">
	<template #header>
		<i class="ti ti-timeline"></i><span style="margin-left: 8px;">Timeline</span>
	</template>

	<div :class="$style.root">
		<GsTimeline/>
	</div>
</GsWorkspacePanel>
</template>

<script lang="ts" setup>
import { watch, useTemplateRef, ref, onMounted } from 'vue';
import GsWorkspacePanel from './GsWorkspacePanel.vue';
import type { WorkspacePanel } from '@/types/workspace.ts';
import { i18n } from '@/i18n.ts';
import GsTimeline from '@/components/GsTimeline.vue';

const props = defineProps<{
	panel: WorkspacePanel;
	isStacked?: boolean;
}>();
</script>

<style module lang="scss">
.root {
	height: 100%;
}
</style>
