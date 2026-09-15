<template>
<div :class="$style.root">
	<GsWaveform :key="panel.contentType" :direction="verticalPosition ? 'vertical' : 'horizontal'"/>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { WorkspacePanel } from '@/workspace.ts';
import GsWaveform from '@/components/GsWaveform.vue';

const props = defineProps<{
	panel: WorkspacePanel;
}>();

const verticalPosition = computed(() => props.panel.contentType === 'waveformVertical');
</script>

<style module lang="scss">
.root {
	height: 100%;
	padding: 2px 10px 10px 10px;
	box-sizing: border-box;
}
</style>
