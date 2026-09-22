<template>
<GsWindow
	ref="windowEl"
	:canResize="true"
	@close="windowEl?.close()"
	@closed="emit('closed')"
>
	<template #header><i class="ti ti-ease-in-out-control-points"></i> Graph Editor: {{ title ?? props.automationGraph.name ?? 'Inline graph' }}</template>

	<div style="height: 100%;">
		<GsAutomationGraphPointsEditor :key="String(props.automationGraph.isNormalized)" :points="props.automationGraph.points" :isNormalized="props.automationGraph.isNormalized" @change="(points, mergeKey) => emit('change', points, mergeKey)"/>
	</div>
</GsWindow>
</template>

<script lang="ts" setup>
import { useTemplateRef } from 'vue';
import GsWindow from './common/GsWindow.vue';
import GsAutomationGraphPointsEditor from './GsAutomationGraphPointsEditor.vue';
import type { GsAutomationGraph } from '@glitch/shared/types.js';

const props = defineProps<{
	automationGraph: Pick<GsAutomationGraph, 'points' | 'isNormalized'> & { name?: string };
	title?: string;
}>();

const emit = defineEmits<{
	(ev: 'change', points: GsAutomationGraph['points'], mergeKey: string | null): void,
	(ev: 'done'): void,
	(ev: 'closed'): void
}>();

const windowEl = useTemplateRef('windowEl');
</script>

<style lang="scss" module>
</style>
