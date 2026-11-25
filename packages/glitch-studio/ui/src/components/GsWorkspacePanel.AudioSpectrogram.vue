<template>
<div :class="$style.root">
	<GsAudioSpectrogram :options="options"/>
</div>
</template>

<script lang="ts" setup>
import GsAudioSpectrogram from './GsAudioSpectrogram.vue';
import type { PreviewSpectrogramSettings } from '@/audio/audio-preview-types.ts';
import type { WorkspacePanel } from '@/workspace.ts';

defineProps<{
	panel: WorkspacePanel;
	options?: Partial<PreviewSpectrogramSettings>;
}>();
</script>

<style module lang="scss">
.root {
	height: 100%;
	padding: 2px 8px 8px 8px;
	box-sizing: border-box;
}
</style>
