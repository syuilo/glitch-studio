<template>
<GsWorkspaceDivider
	v-if="element.type === 'divider'"
	:divider="element"
/>
<GsWorkspaceTabs
	v-else-if="element.type === 'tabs'"
	:tabs="element"
/>
<GsWorkspacePanel v-else :key="element.id + element.contentType" :panel="element"/>
</template>

<script lang="ts" setup>
import type { WorkspaceElement } from '@/workspace.ts';
import GsWorkspaceDivider from '@/components/GsWorkspaceDivider.vue';
import GsWorkspaceTabs from '@/components/GsWorkspaceTabs.vue';
import GsWorkspacePanel from '@/components/GsWorkspacePanel.vue';

const props = withDefaults(defineProps<{
	element: WorkspaceElement;
}>(), {

});
</script>
