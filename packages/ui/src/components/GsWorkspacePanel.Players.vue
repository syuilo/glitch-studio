<template>
<GsWorkspacePanel :panel="panel">
	<template #header>
		<i class="ti ti-player-play"></i><span style="margin-left: 8px;">Players</span>
	</template>

	<div :class="$style.root">
		<GsPlayers/>
	</div>
</GsWorkspacePanel>
</template>

<script lang="ts" setup>
import { watch, useTemplateRef, ref, onMounted } from 'vue';
import GsWorkspacePanel from './GsWorkspacePanel.vue';
import type { WorkspacePanel } from '@/workspace.ts';
import { i18n } from '@/i18n.ts';
import GsPlayers from '@/components/GsPlayers.vue';

const props = defineProps<{
	panel: WorkspacePanel;
}>();
</script>

<style module lang="scss">
.root {
	height: 100%;
}
</style>
