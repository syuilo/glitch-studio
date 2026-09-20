<template>
<div :class="$style.root">
	<GsExternalParameterInputs/>
</div>
</template>

<script lang="ts" setup>
import { watch, useTemplateRef, ref, onMounted } from 'vue';
import type { WorkspacePanel } from '@/workspace.ts';
import { i18n } from '@/i18n.ts';
import GsExternalParameterInputs from '@/components/GsExternalParameterInputs.vue';

const props = defineProps<{
	panel: WorkspacePanel;
}>();
</script>

<style module lang="scss">
.root {
	height: 100%;
}
</style>
