<template>
<GsWindowTitlebar>
	<div :class="$style.headerLeft">
		<img src="/gs.svg" draggable="false" style="display: block; width: 20px; height: 20px; margin: 0 4px 0 8px;">
		<button
			class="_button"
			:class="$style.headerQuickButton"
			:disabled="!stateManager?.canUndo.value"
			data-test-header-undo
			@click="stateManager?.undo()"
		>
			<i class="ti ti-arrow-back-up"></i>
		</button>
		<button class="_button" :class="$style.headerQuickButton" :disabled="!stateManager?.canRedo.value" @click="stateManager?.redo()"><i class="ti ti-arrow-forward-up"></i></button>
		<template v-if="isElectron">
			<span :class="$style.headerDivider"></span>
			<button
				v-tooltip="i18n.ts.Copy"
				class="_button"
				:class="$style.headerQuickButton"
				:disabled="!headerEditActions.canCopy.value"
				data-editor-command-button
				data-test-header-copy
				@pointerdown.prevent
				@click="headerEditActions.execute('copy')"
			>
				<i class="ti ti-copy"></i>
			</button>
			<button
				v-tooltip="i18n.ts.Paste"
				class="_button"
				:class="$style.headerQuickButton"
				:disabled="!headerEditActions.canPaste.value"
				data-editor-command-button
				data-test-header-paste
				@pointerdown.prevent
				@click="headerEditActions.execute('paste')"
			>
				<i class="ti ti-clipboard"></i>
			</button>
			<button
				v-tooltip="i18n.ts.Cut"
				class="_button"
				:class="$style.headerQuickButton"
				:disabled="!headerEditActions.canCut.value"
				data-editor-command-button
				data-test-header-cut
				@pointerdown.prevent
				@click="headerEditActions.execute('cut')"
			>
				<i class="ti ti-cut"></i>
			</button>
			<button
				v-tooltip="i18n.ts.Delete"
				class="_button"
				:class="$style.headerQuickButton"
				:disabled="!headerEditActions.canDelete.value"
				data-editor-command-button
				data-test-header-delete
				@pointerdown.prevent
				@click="headerEditActions.execute('delete')"
			>
				<i class="ti ti-trash"></i>
			</button>
		</template>
		<span :class="$style.headerDivider"></span>
		<button
			v-tooltip="i18n.ts.Save"
			class="_button"
			:class="$style.headerQuickButton"
			:disabled="projectSession == null || fileOperationBusy || !hasUnsavedChanges"
			data-test-header-save
			@click="projectSession?.saveProject()"
		>
			<i class="ti ti-device-floppy"></i>
		</button>
		<span :class="$style.headerDivider"></span>
		<button class="_button" :class="$style.headerMenuItem" data-test-header-file-menu @click="openHeaderFileMenu">{{ i18n.ts._App.File }}</button>
		<button class="_button" :class="$style.headerMenuItem" @click="openHeaderEditMenu">{{ i18n.ts._App.Edit }}</button>
		<button class="_button" :class="$style.headerMenuItem" data-test-header-view-menu @click="openHeaderViewMenu">{{ i18n.ts._App.View }}</button>
		<button class="_button" :class="$style.headerMenuItem" data-test-header-window-menu @click="openHeaderWindowMenu">{{ i18n.ts._App.Window }}</button>
		<button class="_button" :class="$style.headerMenuItem" @click="openHeaderToolsMenu">{{ i18n.ts._App.Tools }}</button>
		<button class="_button" :class="$style.headerMenuItem" @click="openHeaderHelpMenu">{{ i18n.ts._App.Help }}</button>
	</div>
	<div :class="$style.headerTabs">
		<GsProjectTabs :manager="projectSessions" @newProject="newProject()"/>
	</div>
	<div :class="$style.headerRight">
		<button
			v-if="desktopUpdateUi?.state.value.version != null"
			v-tooltip="i18n.ts._DesktopUpdate.Available"
			class="_button"
			:class="[$style.headerMenuItem, $style.updateNotification]"
			data-test-desktop-update-notification
			@click="desktopUpdateUi?.requestUpdate()"
		>
			<i class="ti ti-circle-open-arrow-up"></i>
		</button>
	</div>
</GsWindowTitlebar>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { genId } from '@gs/shared/utility/id.js';
import type { ProjectSessionContext } from '@/ProjectSessionContext.ts';
import type { EditorEditTarget } from '@/composables/useEditorEditActions.ts';
import type { WorkspacePanel } from '@/workspace.ts';
import GsProjectTabs from '@/components/GsProjectTabs.vue';
import { projectSessions, newProject, newProjectFromImageOrVideo, openProject } from '@/app.ts';
import { useHeaderEditActions } from '@/composables/useHeaderEditActions.ts';
import { preferences } from '@/preferences.ts';
import { desktopUpdateUi } from '@/desktop-update-ui.ts';
import { importVisualModuleFile } from '@/utility/visual-module-file.ts';
import { workspacePanelChoices } from '@/workspace.ts';
import GsWindowTitlebar from '@/components/common/GsWindowTitlebar.vue';
import GsAboutDialog from '@/components/GsAboutDialog.vue';
import GsProjectSettingsDialog from '@/components/GsProjectSettingsDialog.vue';
import GsSettingsDialog from '@/components/GsSettingsDialog.vue';
import GsTimelineExportDialog from '@/components/GsTimelineExportDialog.vue';
import GsWorkspacePanelWindow from '@/components/GsWorkspacePanelWindow.vue';
import { i18n } from '@/i18n.ts';
import * as ui from '@/ui.ts';

const props = defineProps<{ projectSession: ProjectSessionContext | null; editorEditTarget: EditorEditTarget | null }>();
const emit = defineEmits<{ showDashboard: [] }>();
const isElectron = __ELECTRON__;
const stateManager = computed(() => props.projectSession?.projectContext.stateManager);
const hasUnsavedChanges = computed(() => props.projectSession?.hasUnsavedChanges.value ?? false);
const fileOperationBusy = projectSessions.fileOperations.isBusy;
const showAdvancedParameters = preferences.model('showAdvancedParameters');
const headerEditActions = useHeaderEditActions({
	editorTarget: computed(() => props.editorEditTarget),
	isActive: computed(() => props.projectSession != null),
	executeNativeCommand: async command => {
		if (!__ELECTRON__ || window.desktop == null) return;
		await window.desktop.executeEditCommand(command);
	},
	reportError: error => { void ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) }); },
});

// 現在表示中の画像を保存する機能。元解像度での書き出しは独立したExport経路で行う。
function savePreviewSnapshot(projectSession: ProjectSessionContext) {
	projectSession.activePreviewRenderer.value.canvas.toBlob(blob => {
		if (blob == null) return;
		const url = URL.createObjectURL(blob);
		const link = window.document.createElement('a');
		link.href = url;
		link.download = 'preview-' + Date.now() + '.webp';
		link.click();
		URL.revokeObjectURL(url);
	}, 'image/webp', 1);
}

function showAbout() {
	const { dispose } = ui.popup(GsAboutDialog, {}, {
		closed: () => dispose(),
	});
}

function openPreferences() {
	const { dispose } = ui.popup(GsSettingsDialog, {}, { closed: () => dispose() });
}

function openHeaderFileMenu(ev: PointerEvent) {
	// メニューを開いた時点のプロジェクトへ操作を固定し、後から別タブへ切り替わっても誤操作しない。
	const projectSession = props.projectSession;
	ui.popupMenu([{
		id: 'new-project',
		disabled: fileOperationBusy.value,
		text: i18n.ts._Dashboard.NewProject,
		icon: 'ti ti-plus',
		action: () => { void newProject(); },
	}, {
		id: 'new-media-project',
		disabled: fileOperationBusy.value,
		text: `${i18n.ts._Dashboard.OpenMedia}...`,
		icon: 'ti ti-photo-video',
		action: () => { void newProjectFromImageOrVideo(); },
	}, {
		id: 'open-project',
		disabled: fileOperationBusy.value,
		text: `${i18n.ts._App.Open}...`,
		icon: 'ti ti-folder-open',
		action: () => { void openProject(); },
	}, {
		type: 'divider',
	}, {
		id: 'save-project',
		disabled: projectSession == null || fileOperationBusy.value,
		text: i18n.ts.Save,
		icon: 'ti ti-device-floppy',
		action: () => { void projectSession?.saveProject(); },
	}, {
		id: 'save-project-as',
		disabled: projectSession == null || fileOperationBusy.value,
		text: `${i18n.ts._App.SaveAs}...`,
		icon: 'ti ti-device-floppy',
		action: () => { void projectSession?.saveProject(true); },
	}, {
		type: 'divider',
	}, {
		type: 'parent',
		text: i18n.ts.Import,
		icon: 'ti ti-upload',
		children: [{
			disabled: projectSession == null,
			text: i18n.ts._App.ImportVisualModule,
			icon: 'ti ti-box-multiple',
			action: () => { if (projectSession != null) void importVisualModuleFile(projectSession.projectContext); },
		}],
	}, {
		disabled: projectSession == null,
		text: `${i18n.ts._App.SavePreviewSnapshot}...`,
		icon: 'ti ti-photo',
		action: () => {
			if (projectSession != null) savePreviewSnapshot(projectSession);
		},
	}, {
		disabled: projectSession == null,
		text: `${i18n.ts._App.ExportScene}...`,
		icon: 'ti ti-movie',
		action: () => {
			if (projectSession == null) return;
			const { dispose } = ui.popup(GsTimelineExportDialog, {}, { closed: () => dispose() }, projectSession);
		},
	}, {
		type: 'divider',
	}, {
		id: 'close-project',
		disabled: projectSession == null || fileOperationBusy.value,
		text: i18n.ts._App.CloseProject,
		icon: 'ti ti-x',
		action: () => { if (projectSession != null) void projectSessions.close(projectSession); },
	}, {
		type: 'divider',
	}, {
		id: 'dashboard',
		text: i18n.ts._App.Dashboard,
		icon: 'ti ti-layout-dashboard',
		action: () => emit('showDashboard'),
	}], ev.currentTarget ?? ev.target);
}

function openHeaderEditMenu(ev: PointerEvent) {
	const projectSession = props.projectSession;
	ui.popupMenu([{
		id: 'reset-render-history',
		disabled: projectSession == null,
		text: i18n.ts._App.ResetRenderHistory,
		icon: 'ti ti-refresh',
		action: () => projectSession?.previewPlayback.resetRenderHistory(),
	}, {
		type: 'divider',
	}, {
		disabled: projectSession == null,
		text: `${i18n.ts._App.ProjectSettings}...`,
		icon: 'ti ti-file-settings',
		action: () => {
			if (projectSession == null) return;
			const { dispose } = ui.popup(GsProjectSettingsDialog, {}, { closed: () => dispose() }, projectSession);
		},
	}, {
		text: `${i18n.ts._App.Preferences}...`,
		icon: 'ti ti-settings',
		action: openPreferences,
	}], ev.currentTarget ?? ev.target);
}

async function changeZoom(direction: 'in' | 'out') {
	if (!__ELECTRON__) return;
	if (window.desktop == null) throw new Error('Desktop API is unavailable');
	if (direction === 'in') {
		await window.desktop.zoomIn();
	} else {
		await window.desktop.zoomOut();
	}
}

function openHeaderViewMenu(ev: PointerEvent) {
	ui.popupMenu([{
		type: 'switch',
		text: i18n.ts._App.ShowAdvancedParameters,
		ref: showAdvancedParameters,
	}, ...(__ELECTRON__ ? [{
		type: 'divider' as const,
	}, {
		text: i18n.ts._App.ZoomIn,
		icon: 'ti ti-zoom-in',
		action: () => { void changeZoom('in'); },
	}, {
		text: i18n.ts._App.ZoomOut,
		icon: 'ti ti-zoom-out',
		action: () => { void changeZoom('out'); },
	}] : [])], ev.currentTarget ?? ev.target);
}

function openWorkspacePanelWindow(projectSession: ProjectSessionContext, contentType: WorkspacePanel['contentType']) {
	// クリックのユーザー操作権限を維持するため、Vueのマウントを待たずに開く。
	const panelWindow = window.open('', '_blank', 'popup,width=960,height=640');
	if (panelWindow == null) {
		void ui.alert({ type: 'error', text: i18n.ts._DetachableView.PopupBlocked });
		return;
	}
	const panel: WorkspacePanel = { id: genId(), type: 'panel', direction: 'horizontal', contentType };
	const { dispose } = ui.popup(GsWorkspacePanelWindow, { panel, panelWindow }, { closed: () => dispose() }, projectSession);
}

function openHeaderWindowMenu(ev: PointerEvent) {
	const projectSession = props.projectSession;
	ui.popupMenu(workspacePanelChoices.map(({ type, label, icon }) => ({
		text: label,
		icon,
		disabled: projectSession == null,
		action: () => { if (projectSession != null) openWorkspacePanelWindow(projectSession, type); },
	})), ev.currentTarget ?? ev.target);
}

function openHeaderToolsMenu(ev: PointerEvent) {
}

async function toggleDevTools() {
	if (!__ELECTRON__) return;
	if (window.desktop == null) throw new Error('Desktop API is unavailable');
	await window.desktop.toggleDevTools();
}

function openHeaderHelpMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: i18n.ts._App.About,
		icon: 'ti ti-info-circle',
		action: () => {
			showAbout();
		},
	}, {
		text: i18n.ts.UserGuide,
		icon: 'ti ti-help-circle',
		action: () => {
			window.open('https://syuilo.dev/glitch-studio/docs/', '_blank');
		},
	}, ...(__ELECTRON__ ? [{
		text: desktopUpdateUi?.state.value.phase === 'restart-required' ? i18n.ts._DesktopUpdate.RestartRequired
		: desktopUpdateUi?.state.value.version != null ? i18n.ts._DesktopUpdate.Available : i18n.ts._DesktopUpdate.Check,
		icon: 'ti ti-download',
		disabled: desktopUpdateUi == null || ['disabled', 'checking', 'preparing', 'downloading', 'installing'].includes(desktopUpdateUi.state.value.phase),
		action: () => { void (desktopUpdateUi?.state.value.version != null ? desktopUpdateUi.requestUpdate() : desktopUpdateUi?.checkForUpdates()); },
	}, {
		text: i18n.ts._App.ToggleDeveloperTools,
		action: () => { void toggleDevTools(); },
	}] : [])], ev.currentTarget ?? ev.target);
}

</script>

<style module lang="scss">
.headerLeft {
	display: flex;
	flex-shrink: 0;
	align-items: center;
}

.headerTabs {
	position: relative;
	flex: 1;
	min-width: 0;
	padding: 0 0 0 12px;
	box-sizing: border-box;
	height: calc(100% - 5px);
	align-self: end;
}

.headerRight {
	margin-left: auto;
	min-width: 0;
	padding: 0 12px;
	box-sizing: border-box;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.headerDivider {
	width: 1px;
	height: 50%;
	margin: 0 4px;
	background-color: #fff2;
}

.updateNotification {
	color: var(--THEME-accent);
}

.headerQuickButton {
	padding: 0 8px;
	app-region: no-drag;

	&:disabled {
		color: color-mix(in srgb, var(--THEME-fg), transparent 50%);
	}
}

.headerMenuItem {
	padding: 0 8px;
	app-region: no-drag;
}

</style>
