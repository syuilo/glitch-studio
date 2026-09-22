<template>
<GsWindow
	ref="windowEl"
	:canResize="true"
	@close="windowEl?.close()"
	@closed="emit('closed')"
>
	<template #header>Graph Editor: {{ props.automationGraph.name }}</template>

	<div style="height: 100%;">
		<GsAutomationGraphPointsEditor :points="props.automationGraph.points" :isNormalized="props.automationGraph.isNormalized"/>
	</div>
</GsWindow>
</template>

<script lang="ts" setup>
import { computed, watch, ref, useTemplateRef } from 'vue';
import GsWindow from './common/GsWindow.vue';
import GsAutomationGraphPointsEditor from './GsAutomationGraphPointsEditor.vue';
import type { GsAutomationGraph } from '@glitch/shared/types.js';

const props = defineProps<{
	automationGraph: GsAutomationGraph;
}>();

const emit = defineEmits<{
	(ev: 'done'): void,
	(ev: 'closed'): void
}>();

const windowEl = useTemplateRef('windowEl');
</script>

<style lang="scss" module>
</style>
