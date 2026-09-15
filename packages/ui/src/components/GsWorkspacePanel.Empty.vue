<template>
<GsWorkspacePanel :panel="panel">
	<template #header>
		Select panel
	</template>

	<div :class="$style.root">
		<GsButton v-for="choice in choices" :key="choice.type" small @click="switchType(choice.type)">{{ choice.label }}</GsButton>
	</div>
</GsWorkspacePanel>
</template>

<script lang="ts" setup>
import { deepClone } from '@glitch/shared/utility/deep-clone.js';
import GsWorkspacePanel from './GsWorkspacePanel.vue';
import GsButton from './common/GsButton.vue';
import type { WorkspacePanel } from '@/workspace.ts';
import { findWorkspaceParent } from '@/utility/workspace.ts';
import { preferences } from '@/preferences.ts';
import { workspacePanelChoices as choices } from '@/workspace.ts';

const props = defineProps<{
	panel: WorkspacePanel;
}>();

function switchType(type: WorkspacePanel['type']) {
	const workspace = deepClone(preferences.s.workspaceDefinition);
	const parent = findWorkspaceParent(workspace, props.panel.id);
	const panel = parent?.children.find(child => child.id === props.panel.id);
	if (!panel || panel.type === null) return;
	panel.type = type;
	preferences.commit('workspaceDefinition', workspace);
}
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-wrap: wrap;
	align-content: flex-start;
	gap: 8px;
	padding: 12px;
	box-sizing: border-box;
	overflow: auto;
	height: 100%;
}
</style>
