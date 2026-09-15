<template>
<div :class="$style.root">
	<GsAudioSpectrum/>
</div>
</template>

<script lang="ts" setup>
import GsAudioSpectrum from './GsAudioSpectrum.vue';
import type { WorkspacePanel } from '@/workspace.ts';

defineProps<{
	panel: WorkspacePanel;
}>();
</script>

<style module lang="scss">
.root {
	height: 100%;
	padding: 2px 12px 12px;
	box-sizing: border-box;
}
</style>
