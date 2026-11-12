<template>
<!-- モーダルはbody直下に配置し、focus trap解除後に背景へinertを残さない。 -->
<Teleport to="body">
	<GsPopup
		v-for="popup in applicationPopups"
		:key="popup.id"
		:popup="popup"
	/>
</Teleport>
<div :class="$style.root">
	<!-- 切替時には、ヘッダーが記憶するネイティブ入力のフォーカスも切り替える。 -->
	<GsAppHeader
		:key="projectSessions.activeSession.value?.id ?? 'no-project'"
		:projectSession="projectSessions.activeSession.value"
		:editorEditTarget="activeEditorEditTarget"
		@showDashboard="showDashboard"
	/>
	<GsProjectTabs :manager="projectSessions" @newProject="newProject()"/>
	<div :class="$style.editors">
		<GsProjectEditor
			v-for="session in projectSessions.sessions.value"
			:key="session.id"
			ref="projectEditors"
			:projectSession="session"
			:active="session === projectSessions.activeSession.value"
		/>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, useTemplateRef } from 'vue';
import { disposeApplication, projectSessions, newProject, newProjectFromMediaPath, openProject } from './app.ts';
import { desktopProjectFile } from './gsproj.ts';
import { installProjectCloseGuard } from './project-close-guard.ts';
import { applicationActivity } from './application-activity.ts';
import GsPopup from './components/GsPopup.vue';
import GsProjectEditor from './components/GsProjectEditor.vue';
import GsAppHeader from './components/GsAppHeader.vue';
import GsProjectTabs from './components/GsProjectTabs.vue';
import GsDashboardDialog from './components/GsDashboardDialog.vue';
import * as ui from './ui.ts';

const applicationPopups = computed(() => ui.popups.value.filter(popup => popup.projectSession == null));
const projectEditors = useTemplateRef('projectEditors');
const activeEditorEditTarget = computed(() => projectEditors.value?.find(editor => editor?.sessionId === projectSessions.activeSession.value?.id)?.editorEditTarget ?? null);
const disposeCloseGuard = installProjectCloseGuard(projectSessions.isProjectSaving, applicationActivity.isExporting, projectSessions.hasUnsavedChanges);
onBeforeUnmount(() => {
	disposeCloseGuard();
	void disposeApplication().catch(console.error);
});

let dashboardOpen = false;

function showDashboard() {
	if (dashboardOpen) return;
	dashboardOpen = true;
	const { dispose } = ui.popup(GsDashboardDialog, {}, { closed: () => { dashboardOpen = false; dispose(); } });
}

onMounted(async () => {
	try {
		const startupFile = await window.desktop?.takeStartupFile();
		if (startupFile?.kind === 'project' && await openProject(null, desktopProjectFile(startupFile.file))) return;
		if (startupFile?.kind === 'media' && await newProjectFromMediaPath(startupFile.path, startupFile.type)) return;
	} catch (error) {
		console.error(error);
		await ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
	} finally {
		await window.desktop?.releaseProjectReservations?.('startup').catch(console.error);
	}
	showDashboard();
});
</script>

<style module lang="scss">
.root {
	position: absolute;
	display: flex;
	flex-direction: column;
	height: 100%;
	width: 100%;
	overflow: clip;
}

.editors {
	position: relative;
	flex: 1;
	min-height: 0;
}
</style>
