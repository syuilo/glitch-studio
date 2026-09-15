<template>
<GsWorkspacePanel :panel="panel">
	<template #header><i class="ti ti-wave-sine"></i><span style="margin-left: 8px;">Audio Waveform</span></template>
	<div :class="$style.root"><GsAudioWaveform/></div>
</GsWorkspacePanel>
</template>

<script lang="ts" setup>
import GsWorkspacePanel from './GsWorkspacePanel.vue';
import GsAudioWaveform from './GsAudioWaveform.vue';
import type { WorkspacePanel } from '@/workspace.ts';

defineProps<{
	panel: WorkspacePanel;
}>();
</script>

<style module lang="scss">
.root { height: 100%; padding: 2px 12px 12px; box-sizing: border-box; }
</style>
