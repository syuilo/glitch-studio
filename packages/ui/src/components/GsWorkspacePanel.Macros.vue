<template>
<GsWorkspacePanel :panel="panel">
	<template #header>
		<i class="ti ti-adjustments-horizontal"></i><span style="margin-left: 8px;">Macros</span>
	</template>

	<div :class="$style.root">
		<GsMacros/>
	</div>
</GsWorkspacePanel>
</template>

<script lang="ts" setup>
import { watch, useTemplateRef, ref, onMounted } from 'vue';
import GsWorkspacePanel from './GsWorkspacePanel.vue';
import type { WorkspacePanel } from '@/workspace.ts';
import { i18n } from '@/i18n.ts';
import GsMacros from '@/components/GsMacros.vue';

const props = defineProps<{
	panel: WorkspacePanel;
}>();
</script>

<style module lang="scss">
.root {
	height: 100%;
}
</style>
