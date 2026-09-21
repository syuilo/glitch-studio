<template>
<GsWindow
	ref="windowEl"
	:canResize="true"
	@close="windowEl?.close()"
	@closed="emit('closed')"
>
	<template #header>aaa</template>

	<div style="height: 100%;">
		<GsAutomationEditor :isMsUnit="false" :automation="props.automation"/>
	</div>
</GsWindow>
</template>

<script lang="ts" setup>
import { computed, watch, ref, useTemplateRef } from 'vue';
import GsWindow from './common/GsWindow.vue';
import GsAutomationEditor from './GsAutomationEditor.vue';
import type { GsAutomation } from '@glitch/shared/types.js';

const props = defineProps<{
	automation: GsAutomation;
}>();

const emit = defineEmits<{
	(ev: 'done'): void,
	(ev: 'closed'): void
}>();

const windowEl = useTemplateRef('windowEl');
</script>

<style lang="scss" module>
</style>
