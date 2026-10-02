<template>
<div :class="$style.root">
	<GsAudioSpectrogram :options="options"/>
</div>
</template>

<script lang="ts" setup>
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
	padding: 2px 10px 10px 10px;
	box-sizing: border-box;
}
</style>
