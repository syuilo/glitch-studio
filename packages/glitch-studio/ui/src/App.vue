<template>
<!-- モーダルはbody直下に配置し、focus trap解除後に背景へinertを残さない。 -->
<Teleport to="body">
	<GsPopup
		v-for="popup in applicationPopups"
		:key="popup.id"
		:popup="popup"
	/>
</Teleport>
<GsProjectEditor
	v-for="session in projectSessions.sessions.value"
	:key="session.id"
	:projectSession="session"
	:active="session === projectSessions.activeSession.value"
/>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { disposeApplication, projectSessions, newProjectFromMediaPath, openProject } from './app.ts';
import { desktopProjectFile } from './gsproj.ts';
import { installProjectCloseGuard } from './project-close-guard.ts';
import { applicationActivity } from './application-activity.ts';
import GsPopup from './components/GsPopup.vue';
import GsProjectEditor from './components/GsProjectEditor.vue';
import GsDashboardDialog from './components/GsDashboardDialog.vue';
import * as ui from './ui.ts';

const applicationPopups = computed(() => ui.popups.value.filter(popup => popup.projectSession == null));
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
watch(projectSessions.activeSession, session => {
	if (!session.projectContext.hasProject) showDashboard();
});

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
