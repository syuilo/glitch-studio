<template>
<div :class="$style.root">
	<div v-for="value in appContext.undoStack.value">
		<div>{{ COMMAND_DEFS[value.type].label }}</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { watch, useTemplateRef, ref, onMounted } from 'vue';
import type { WorkspacePanel } from '@/workspace.ts';
import { i18n } from '@/i18n.ts';
import { appContext } from '@/app.ts';
import { COMMAND_DEFS } from '@/commands.ts';

const props = defineProps<{
	panel: WorkspacePanel;
}>();
</script>

<style module lang="scss">
.root {
	height: 100%;
}
</style>
