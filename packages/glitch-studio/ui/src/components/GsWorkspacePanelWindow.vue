<template>
<Teleport :to="panelWindow.document.body">
	<div ref="root" :class="$style.root" :data-test-workspace-panel-window="panel.contentType">
		<GsDetachedWindowFrame :title="workspacePanelDefinitions[panel.contentType].label" :customTitlebar="isElectron">
			<component :is="workspacePanelDefinitions[panel.contentType].component" :panel="panel"/>
		</GsDetachedWindowFrame>
	</div>
</Teleport>
</template>

<script lang="ts" setup>
import { inject, onBeforeUnmount, onMounted, useTemplateRef } from 'vue';
import GsDetachedWindowFrame from './GsDetachedWindowFrame.vue';
import type { WorkspacePanel } from '@/workspace.ts';
import { workspacePanelDefinitions } from '@/workspace.ts';
import { workspaceControllerKey } from '@/WorkspaceController.ts';
import { fileDropTargetInstallerKey } from '@/utility/file-drop.ts';
import { prepareDetachedWindow } from '@/utility/detached-window.ts';

const props = defineProps<{
	panel: WorkspacePanel;
	panelWindow: Window;
}>();
const emit = defineEmits<{ closed: [] }>();
const isElectron = __ELECTRON__;
const root = useTemplateRef('root');
const workspaceController = inject(workspaceControllerKey)!;
const installFileDrops = inject(fileDropTargetInstallerKey, null);
let disposeFileDrops: (() => void) | null = null;

prepareDetachedWindow(props.panelWindow, workspacePanelDefinitions[props.panel.contentType].label);
workspaceController.windowPanels.set(props.panel.id, props.panel);

function onPanelWindowClosed() {
	emit('closed');
}

function closePanelWindow() {
	props.panelWindow.close();
}

props.panelWindow.addEventListener('pagehide', onPanelWindowClosed);
window.addEventListener('pagehide', closePanelWindow);
onMounted(() => {
	if (props.panelWindow.closed) {
		emit('closed');
		return;
	}
	if (root.value != null) disposeFileDrops = installFileDrops?.(root.value) ?? null;
});
onBeforeUnmount(() => {
	disposeFileDrops?.();
	workspaceController.windowPanels.delete(props.panel.id);
	props.panelWindow.removeEventListener('pagehide', onPanelWindowClosed);
	window.removeEventListener('pagehide', closePanelWindow);
	closePanelWindow();
});
</script>

<style module lang="scss">
.root {
	width: 100%;
	height: 100%;
	overflow: clip;
	contain: strict;
	container-type: size;
	background: var(--THEME-panel);
}
</style>
