<template>
<div :class="$style.root">
	<GsHistogram/>
</div>
</template>

<script lang="ts" setup>
import { watch, useTemplateRef, ref, onMounted } from 'vue';
import type { WorkspacePanel } from '@/workspace.ts';
import { i18n } from '@/i18n.ts';
import GsHistogram from '@/components/GsHistogram.vue';

const props = defineProps<{
	panel: WorkspacePanel;
}>();
</script>

<style module lang="scss">
.root {
	height: 100%;
	padding: 2px 10px 10px 10px;
	box-sizing: border-box;
}
</style>
