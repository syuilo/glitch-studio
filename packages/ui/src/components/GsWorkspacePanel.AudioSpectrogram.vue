<template>
<GsWorkspacePanel :panel="panel">
	<template #header><i class="ti ti-chart-area"></i><span style="margin-left: 8px;">Audio Spectrogram</span></template>
	<div :class="$style.root"><GsAudioSpectrogram :options="options"/></div>
</GsWorkspacePanel>
</template>

<script lang="ts" setup>
import GsWorkspacePanel from './GsWorkspacePanel.vue';
import GsAudioSpectrogram from './GsAudioSpectrogram.vue';
import type { WorkspacePanel } from '@/workspace.ts';

defineProps<{
	panel: WorkspacePanel;
	options?: any;
}>();
</script>

<style module lang="scss">
.root {
	height: 100%;
	padding: 2px 12px 12px;
	box-sizing: border-box;
}
</style>
