<template>
<GsWorkspacePanel :panel="panel">
	<template #header>
		<i class="ti ti-device-desktop"></i><span style="margin-left: 8px;">Preview</span>
	</template>

	<div :class="$style.root">
		<GsPreview/>
	</div>
</GsWorkspacePanel>
</template>

<script lang="ts" setup>
import { watch, useTemplateRef, ref, onMounted } from 'vue';
import GsWorkspacePanel from './GsWorkspacePanel.vue';
import GsPreview from './GsPreview.vue';
import type { WorkspacePanel } from '@/types/workspace.ts';
import { i18n } from '@/i18n.ts';

const props = defineProps<{
	panel: WorkspacePanel;
}>();

</script>

<style module lang="scss">
.root {
	height: 100%;
	box-sizing: border-box;
}
</style>
