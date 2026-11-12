<template>
<div v-if="manager.sessions.value.length > 1" :class="$style.root" data-test-project-tabs>
	<div
		v-for="session in manager.sessions.value"
		:key="session.id"
		:class="[$style.tab, { [$style.active]: session === manager.activeSession.value }]"
		:data-project-session-id="session.id"
		data-test-project-tab
	>
		<button class="_button" :class="$style.select" data-test-select-project @click="manager.select(session)">
			<span :class="$style.name">{{ session.projectContext.stateManager.state.name.value }}</span>
			<span v-if="session.hasUnsavedChanges.value" v-tooltip="i18n.ts._App.UnsavedChanges" data-test-project-tab-unsaved>*</span>
			<i v-if="session.isProjectSaving.value" class="ti ti-loader" data-test-project-tab-saving></i>
		</button>
		<button
			v-tooltip="i18n.ts._App.CloseProject"
			class="_button"
			:class="$style.close"
			:disabled="manager.fileOperations.isBusy.value"
			data-test-close-project
			@click="manager.close(session)"
		><i class="ti ti-x"></i></button>
	</div>
	<button
		v-tooltip="i18n.ts._Dashboard.NewProject"
		class="_button"
		:class="$style.add"
		:disabled="manager.fileOperations.isBusy.value"
		data-test-new-project
		@click="emit('newProject')"
	><i class="ti ti-plus"></i></button>
</div>
</template>

<script lang="ts" setup>
import type { ProjectSessionManager } from '@/ProjectSessionManager.ts';
import { i18n } from '@/i18n.ts';

defineProps<{ manager: ProjectSessionManager }>();
const emit = defineEmits<{ newProject: [] }>();
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-shrink: 0;
	gap: 4px;
	padding: 4px 12px 8px;
	overflow-x: auto;
}

.tab {
	display: flex;
	flex: 0 0 auto;
	max-width: 280px;
	border-radius: 6px;
	background: var(--THEME-globalBg);
	opacity: 0.65;
}

.active {
	opacity: 1;
	box-shadow: inset 0 -2px var(--THEME-accent);
}

.select {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
	padding: 8px 12px;
}

.name {
	white-space: nowrap;
	overflow: clip;
	text-overflow: ellipsis;
}

.close, .add {
	flex-shrink: 0;
	padding: 0 10px;
	border-radius: 6px;

	&:hover {
		background: #fff1;
	}
}
</style>
