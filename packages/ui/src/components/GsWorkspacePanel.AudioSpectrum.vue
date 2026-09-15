<template>
<GsWorkspacePanel :panel="panel">
	<template #header><i class="ti ti-chart-column"></i><span style="margin-left: 8px;">Audio Spectrum</span></template>
	<div :class="$style.root"><GsAudioSpectrum/></div>
</GsWorkspacePanel>
</template>

<script lang="ts" setup>
import GsWorkspacePanel from './GsWorkspacePanel.vue';
import GsAudioSpectrum from './GsAudioSpectrum.vue';
import type { WorkspacePanel } from '@/types/workspace.ts';

defineProps<{
	panel: WorkspacePanel;
}>();
</script>

<style module lang="scss">
.root { height: 100%; padding: 2px 12px 12px; box-sizing: border-box; }
</style>
