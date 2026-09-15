<template>
<div :class="$style.root">
	<GsAssets/>
</div>
</template>

<script lang="ts" setup>
import { watch, useTemplateRef, ref, onMounted } from 'vue';
import GsAssets from './GsAssets.vue';
import type { WorkspacePanel } from '@/workspace.ts';
import { i18n } from '@/i18n.ts';

const props = defineProps<{
	panel: WorkspacePanel;
}>();
</script>

<style module lang="scss">
.root {
	height: 100%;
}
</style>
