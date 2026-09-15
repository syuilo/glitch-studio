<template>
<GsWorkspacePanel :panel="panel" :isStacked="isStacked">
	<template #header>
		<i class="ti ti-chart-column"></i><span style="margin-left: 8px;">{{ verticalPosition ? 'Waveform (Y)' : 'Waveform (X)' }}</span>
	</template>

	<div :class="$style.root">
		<GsWaveform :key="panel.type" :direction="verticalPosition ? 'vertical' : 'horizontal'"/>
	</div>
</GsWorkspacePanel>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import GsWorkspacePanel from './GsWorkspacePanel.vue';
import type { WorkspacePanel } from '@/types/workspace.ts';
import GsWaveform from '@/components/GsWaveform.vue';

const props = defineProps<{
	panel: WorkspacePanel;
	isStacked?: boolean;
}>();

const verticalPosition = computed(() => props.panel.type === 'waveformVertical');
</script>

<style module lang="scss">
.root {
	height: 100%;
	padding: 2px 12px 12px 12px;
	box-sizing: border-box;
}
</style>
