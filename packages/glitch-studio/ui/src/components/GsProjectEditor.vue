<template>
<!-- 個別にTeleportするモーダルと階層を揃え、focus trapの解除後に背景内部のinertが残るのを防ぐ。 -->
<Teleport to="body">
	<GsPopup
		v-for="popup in sessionPopups"
		:key="popup.id"
		:popup="popup"
	/>
</Teleport>

<div v-show="active" ref="root" :class="$style.root" data-test-project-editor :data-project-session-id="projectSession.id">
	<GsWindowTitlebar>
		<div :class="$style.headerLeft">
			<img src="/gs.svg" draggable="false" style="display: block; width: 20px; height: 20px; margin: 0 4px 0 8px;">
			<button class="_button" :class="$style.headerQuickButton" :disabled="!stateManager.canUndo.value" @click="stateManager.undo()"><i class="ti ti-arrow-back-up"></i></button>
			<button class="_button" :class="$style.headerQuickButton" :disabled="!stateManager.canRedo.value" @click="stateManager.redo()"><i class="ti ti-arrow-forward-up"></i></button>
			<template v-if="isElectron">
				<span :class="$style.headerDivider"></span>
				<button v-tooltip="i18n.ts.Copy" class="_button" :class="$style.headerQuickButton" :disabled="!headerEditActions.canCopy.value" data-editor-command-button data-test-header-copy @pointerdown.prevent @click="headerEditActions.execute('copy')"><i class="ti ti-copy"></i></button>
				<button v-tooltip="i18n.ts.Paste" class="_button" :class="$style.headerQuickButton" :disabled="!headerEditActions.canPaste.value" data-editor-command-button data-test-header-paste @pointerdown.prevent @click="headerEditActions.execute('paste')"><i class="ti ti-clipboard"></i></button>
				<button v-tooltip="i18n.ts.Cut" class="_button" :class="$style.headerQuickButton" :disabled="!headerEditActions.canCut.value" data-editor-command-button data-test-header-cut @pointerdown.prevent @click="headerEditActions.execute('cut')"><i class="ti ti-cut"></i></button>
				<button v-tooltip="i18n.ts.Delete" class="_button" :class="$style.headerQuickButton" :disabled="!headerEditActions.canDelete.value" data-editor-command-button data-test-header-delete @pointerdown.prevent @click="headerEditActions.execute('delete')"><i class="ti ti-trash"></i></button>
			</template>
			<span :class="$style.headerDivider"></span>
			<button v-tooltip="i18n.ts.Save" class="_button" :class="$style.headerQuickButton" :disabled="isProjectSaving || !hasUnsavedChanges" @click="projectSession.saveProject()"><i class="ti ti-device-floppy"></i></button>
			<span :class="$style.headerDivider"></span>
			<button class="_button" :class="$style.headerMenuItem" @click="openHeaderFileMenu">{{ i18n.ts._App.File }}</button>
			<button class="_button" :class="$style.headerMenuItem" @click="openHeaderEditMenu">{{ i18n.ts._App.Edit }}</button>
			<button class="_button" :class="$style.headerMenuItem" data-test-header-view-menu @click="openHeaderViewMenu">{{ i18n.ts._App.View }}</button>
			<button class="_button" :class="$style.headerMenuItem" data-test-header-window-menu @click="openHeaderWindowMenu">{{ i18n.ts._App.Window }}</button>
			<button class="_button" :class="$style.headerMenuItem" @click="openHeaderToolsMenu">{{ i18n.ts._App.Tools }}</button>
			<button class="_button" :class="$style.headerMenuItem" @click="openHeaderHelpMenu">{{ i18n.ts._App.Help }}</button>
			<button v-if="desktopUpdateUi?.state.value.version != null" class="_button" :class="[$style.headerMenuItem, $style.updateNotification]" data-test-desktop-update-notification @click="desktopUpdateUi?.requestUpdate()">{{ i18n.ts._DesktopUpdate.Available }}</button>
		</div>
		<div :class="$style.headerCenter">
			{{ projectName }}
			<span v-if="hasUnsavedChanges" v-tooltip="i18n.ts._App.UnsavedChanges">*</span>
			<span v-if="projectFileName" :class="$style.projectFileName">({{ projectFileName }})</span>
		</div>
		<div :class="$style.headerRight">
			<span v-if="isProjectSaving" :class="$style.projectSaving" data-test-project-saving>{{ i18n.ts._App.ProjectSaving }}<GsEllipsis/></span>
		</div>
	</GsWindowTitlebar>
	<GsProjectTabs :manager="projectSessions" @newProject="newProject()"/>
	<div :class="$style.body">
		<!-- Canvas停止後もワークスペースの合成が映像出力を待たせる環境がある。DOMとレイアウト設定は保持し、bodyへTeleportした進捗・キャンセルUIは表示し続ける。 -->
		<GsWorkspaceElement v-show="!projectSession.renderEngine.isSuspended.value" style="flex: 1" :element="preferences.r.workspaceDefinition.value" data-test-workspace-rendering-surface/>
	</div>
	<div :class="$style.footer" class="_monospace">
		<div :class="$style.footerLeft">
			<div :class="$style.footerSection">
				<div :class="$style.footerSectionTitle">{{ i18n.ts._App.Project }}:</div>
				<div :class="$style.footerSectionContents">
					<button :class="$style.footerItem" class="_button" @click="openProjectSettings">{{ stateManager.state.resolution.value.width }} x {{ stateManager.state.resolution.value.height }} px / {{ stateManager.state.timelineFps.value }}fps</button>
				</div>
			</div>
			<div :class="$style.footerSection">
				<div :class="$style.footerSectionTitle">{{ i18n.ts._App.Preview }}:</div>
				<div :class="$style.footerSectionContents">
					<button :class="$style.footerItem" class="_button" @click="openResolutionFactorMenu">{{ Math.round(stateManager.state.resolution.value.width * resolutionFactor) }} x {{ Math.round(stateManager.state.resolution.value.height * resolutionFactor) }} px ({{ resolutionFactor }}x)</button>
					<button v-if="previewPlayback.state.value.mode === 'timeline' && stateManager.state.timelineMotionBlur.value.enabled" :class="$style.footerItem" class="_button" v-tooltip="i18n.ts._App.MotionBlurSamplesHint" @click="openMotionBlurSamplesMenu">{{ i18n.ts._App.MotionBlur }}: {{ timelinePreviewMotionBlurSamples === 0 ? i18n.ts.Off : `${timelinePreviewMotionBlurSamples} samples` }}</button>
					<button :class="$style.footerItem" class="_button" @click="openFpsMenu">{{ previewPlayback.state.value.mode === 'visualModuleLivePreview' ? visualModuleLivePreviewFpsLabel : `${stateManager.state.timelineFps.value * timelinePreviewFpsFactor}fps (${timelinePreviewFpsFactor}x)` }}</button>
					<button v-if="previewPlayback.state.value.mode === 'visualModuleLivePreview'" :class="$style.footerItem" class="_button" @click="openTimeFactorMenu">{{ i18n.ts._App.Time }}: {{ visualModuleLivePreviewTimeFactor }}x</button>
					<div :class="[$style.footerItem, $style.previewVolume]">
						<i :class="previewVolume === 0 ? 'ti ti-volume-off' : 'ti ti-volume'"></i>
						<GsRange v-model="previewVolume" :min="0" :max="1" :step="0.01" :continuousUpdate="true" style="width: 150px;"/>
						<span :class="$style.volumeValue">{{ Math.round(previewVolume * 100) }}%</span>
					</div>
				</div>
			</div>
		</div>
		<div :class="$style.footerRight">
			<button v-if="preferences.r.projectBackupAutoEnabled.value || preferences.r.projectBackupSaveEnabled.value" class="_button" :class="$style.footerItem" v-tooltip="projectBackupStatus.error ?? i18n.ts._App.BackupHint" @click="openPreferences">{{ projectBackupStatus.error ? i18n.ts._App.BackupError : projectBackupAccess === 'ready' ? i18n.ts._App.Backups : projectBackupAccess === 'unsaved' ? i18n.ts._App.BackupsUnsaved : i18n.ts._App.BackupsFolderRequired }}</button>
			<div v-if="activePreviewRenderer.errorMessage.value != null" v-tooltip="activePreviewRenderer.errorMessage.value" :class="$style.footerError"><i class="ti ti-alert-triangle"></i> {{ activePreviewRenderer.errorMessage.value }}</div>
			<div :class="$style.footerStats">
				<div data-test-timeline-frame-cache-usage :class="$style.footerMemory">{{ i18n.tsx._App.TimelineFrameCacheUsage({ usage: timelineFrameCacheUsageLabel }) }}</div>
				<button data-test-analysis-monitors-toggle :class="$style.footerItem" class="_button" @click="analysisMonitorsEnabled = !analysisMonitorsEnabled">{{ i18n.ts._App.Analyze }}: {{ analysisMonitorsEnabled ? i18n.ts.Enabled : i18n.ts.Disabled }}</button>
				<button data-test-rendering-stats-toggle :class="$style.footerItem" class="_button" @click="renderingStatsEnabled = !renderingStatsEnabled">{{ i18n.ts._Workspace.Stats }}: {{ renderingStatsEnabled ? i18n.ts.Enabled : i18n.ts.Disabled }}</button>
				<div v-if="renderingStatsEnabled && previewPlayback.state.value.mode === 'visualModuleLivePreview' && visualModuleRendererManagerController.gpuMemoryUsage.value" v-tooltip="gpuMemoryTooltip" :class="$style.footerMemory">{{ (visualModuleRendererManagerController.gpuMemoryUsage.value.total / 1000 ** 2).toFixed(1) }} MB</div>
			</div>
			<div :class="$style.outputLevelMeter">
				<GsAudioLevelMeter :levels="audioOutput.outputLevels"/>
			</div>
		</div>
	</div>
	<GsDropOverlay v-if="fileDropHovering" data-test-app-drop-overlay/>
</div>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, provide, computed, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { genId } from '@gs/shared/utility/id.js';
import { projectSessions, newProject, newProjectFromImageOrVideo, openProject } from '@/app.ts';
import type { ProjectSessionContext } from '@/ProjectSessionContext.ts';
import GsProjectTabs from '@/components/GsProjectTabs.vue';
import { TIMELINE_PREVIEW_MOTION_BLUR_SAMPLE_OPTIONS } from '@/ProjectSessionContext.ts';
import GsPopup from '@/components/GsPopup.vue';
import { projectSessionKey } from '@/project-session.ts';
import { preferences } from '@/preferences.ts';
import { WorkspaceController, workspaceControllerKey } from '@/WorkspaceController.ts';
import { desktopUpdateUi } from '@/desktop-update-ui.ts';
import { importVisualModuleFile } from '@/utility/visual-module-file.ts';
import { importAssets } from '@/utility/import-assets.ts';
import { fileDropTargetInstallerKey, installFileDropHandlers } from '@/utility/file-drop.ts';
import { editorEditTargetKey } from '@/composables/useEditorEditActions.ts';
import { useHeaderEditActions } from '@/composables/useHeaderEditActions.ts';
import GsRange from '@/components/common/GsRange.vue';
import GsDropOverlay from '@/components/common/GsDropOverlay.vue';
import GsEllipsis from '@/components/common/GsEllipsis.vue';
import GsWindowTitlebar from '@/components/common/GsWindowTitlebar.vue';
import type { EditorEditTarget } from '@/composables/useEditorEditActions.ts';
import type { WorkspacePanel } from '@/workspace.ts';
import GsAboutDialog from '@/components/GsAboutDialog.vue';
import GsProjectSettingsDialog from '@/components/GsProjectSettingsDialog.vue';
import GsSettingsDialog from '@/components/GsSettingsDialog.vue';
import GsTimelineExportDialog from '@/components/GsTimelineExportDialog.vue';
import GsWorkspaceElement from '@/components/GsWorkspaceElement.vue';
import GsWorkspacePanelWindow from '@/components/GsWorkspacePanelWindow.vue';
import { workspacePanelChoices } from '@/workspace.ts';
import { i18n } from '@/i18n.ts';
import GsAudioLevelMeter from '@/components/common/GsAudioLevelMeter.vue';
import * as ui from '@/ui.ts';

const props = defineProps<{ projectSession: ProjectSessionContext; active: boolean }>();
const projectSession = props.projectSession;
provide(projectSessionKey, projectSession);
const sessionPopups = computed(() => ui.popups.value.filter(popup => popup.projectSession === projectSession));

const workspaceController = new WorkspaceController(preferences.r.workspaceDefinition, root => preferences.commit('workspaceDefinition', root));
provide(workspaceControllerKey, workspaceController);
watch(projectSession.workspacePanelRevealRequest, request => {
	if (request == null) return;
	workspaceController.revealPanel(request);
	projectSession.workspacePanelRevealRequest.value = null;
}, { immediate: true });
provide(fileDropTargetInstallerKey, installFileDrops);
const isElectron = __ELECTRON__;
const editorEditTarget = shallowRef<EditorEditTarget | null>(null);
provide(editorEditTargetKey, editorEditTarget);
const headerEditActions = useHeaderEditActions({
	editorTarget: editorEditTarget,
	isActive: computed(() => props.active),
	executeNativeCommand: async command => {
		if (!__ELECTRON__ || window.desktop == null) return;
		await window.desktop.executeEditCommand(command);
	},
	reportError: error => { void ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) }); },
});

async function onFileDrop(files: File[], event: DragEvent) {
	if (files.length === 1 && files[0].name.toLowerCase().endsWith('.gsproj')) {
		const item = Array.from(event.dataTransfer?.items ?? []).find(item => item.kind === 'file');
		const handle = await item?.getAsFileSystemHandle?.().catch(() => null);
		await openProject(files[0], handle?.kind === 'file' ? handle as FileSystemFileHandle : null);
		return;
	}
	let target = projectSession;
	const ids = await importAssets(target.projectContext, files, async () => {
		if (!target.projectContext.hasProject) target = await newProject() ?? target;
		return target.projectContext;
	});
	if (ids.length > 0) target.workspacePanelRevealRequest.value = { contentType: 'assets', sourcePanelId: null };
}

function installFileDrops(target: HTMLElement) {
	return installFileDropHandlers(target, onFileDrop,
		error => { void ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) }); },
		() => window.document.body.hasAttribute('inert'),
		target === root.value ? hovering => { fileDropHovering.value = hovering; } : undefined);
}

const root = useTemplateRef('root');
const fileDropHovering = ref(false);
let disposeFileDrops: (() => void) | null = null;
onMounted(() => {
	if (root.value != null) disposeFileDrops = installFileDrops(root.value);
});

const { audioOutput, activePreviewRenderer, previewPlayback, visualModuleRendererManagerController, timelineRendererManagerController, resolutionFactor, visualModuleLivePreviewFpsLimit, timelinePreviewFpsFactor, timelinePreviewMotionBlurSamples, visualModuleLivePreviewTimeFactor, projectBackupAccess, projectBackupStatus } = projectSession;
const timelineFrameCacheUsageLabel = computed(() => {
	if (!timelineRendererManagerController.isFrameCacheEnabled.value) return i18n.ts.Disabled;
	const ratio = timelineRendererManagerController.frameCacheUsageRatio.value;
	return ratio == null ? '—' : `${(ratio * 100).toFixed(1)}%`;
});
const renderingStatsEnabled = preferences.model('renderingStatsEnabled');
const analysisMonitorsEnabled = preferences.model('analysisMonitorsEnabled');
const showAdvancedParameters = preferences.model('showAdvancedParameters');
const visualModuleLivePreviewFpsLabel = computed(() => renderingStatsEnabled.value
	? `${Math.round(visualModuleRendererManagerController.fpsDisplay.value)}fps`
	: `${visualModuleLivePreviewFpsLimit.value ?? '∞'}fps`);
const { stateManager } = projectSession.projectContext;
const { name: projectName } = projectSession.projectContext.stateManager.state;
const { projectFileName, hasUnsavedChanges, isProjectSaving } = projectSession;

const releaseOutputCapture = audioOutput.retainOutputCapture();

onBeforeUnmount(() => {
	disposeFileDrops?.();
	releaseOutputCapture();
});

const previewVolume = preferences.model('previewVolume');
watch(previewVolume, (newValue) => {
	audioOutput.setPreviewVolume(newValue);
}, { immediate: true });

const gpuMemoryTooltip = computed(() => {
	const usage = visualModuleRendererManagerController.gpuMemoryUsage.value;
	if (!usage) return '';
	return i18n.t('GpuMemoryEstimate', {
		textures: (usage.textures / 1024 ** 2).toFixed(1),
		buffers: (usage.buffers / 1024 ** 2).toFixed(1),
	});
});

// 現在表示中の画像を保存する機能。元解像度での書き出しは独立したExport経路で行う。
function savePreviewSnapshot() {
	activePreviewRenderer.value.canvas.toBlob(blob => {
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

function openTimeFactorMenu(ev: PointerEvent) {
	ui.popupMenu([{
		type: 'radioOption',
		text: '-1x',
		active: computed(() => visualModuleLivePreviewTimeFactor.value === -1),
		action: () => visualModuleLivePreviewTimeFactor.value = -1,
	}, {
		type: 'radioOption',
		text: '0x',
		active: computed(() => visualModuleLivePreviewTimeFactor.value === 0),
		action: () => visualModuleLivePreviewTimeFactor.value = 0,
	}, {
		type: 'radioOption',
		text: '0.5x',
		active: computed(() => visualModuleLivePreviewTimeFactor.value === 0.5),
		action: () => visualModuleLivePreviewTimeFactor.value = 0.5,
	}, {
		type: 'radioOption',
		text: '1x',
		active: computed(() => visualModuleLivePreviewTimeFactor.value === 1),
		action: () => visualModuleLivePreviewTimeFactor.value = 1,
	}, {
		type: 'radioOption',
		text: '2x',
		active: computed(() => visualModuleLivePreviewTimeFactor.value === 2),
		action: () => visualModuleLivePreviewTimeFactor.value = 2,
	}], ev.currentTarget ?? ev.target);
}

function openProjectSettings() {
	const { dispose } = ui.popup(GsProjectSettingsDialog, {}, { closed: () => dispose() }, projectSession);
}

function openPreferences() {
	const { dispose } = ui.popup(GsSettingsDialog, {}, { closed: () => dispose() });
}

function openResolutionFactorMenu(ev: PointerEvent) {
	ui.popupMenu([{
		type: 'radioOption',
		text: '4x',
		active: computed(() => resolutionFactor.value === 4),
		action: () => resolutionFactor.value = 4,
	}, {
		type: 'radioOption',
		text: '2x',
		active: computed(() => resolutionFactor.value === 2),
		action: () => resolutionFactor.value = 2,
	}, {
		type: 'radioOption',
		text: '1x',
		active: computed(() => resolutionFactor.value === 1),
		action: () => resolutionFactor.value = 1,
	}, {
		type: 'radioOption',
		text: '0.5x',
		active: computed(() => resolutionFactor.value === 0.5),
		action: () => resolutionFactor.value = 0.5,
	}, {
		type: 'radioOption',
		text: '0.25x',
		active: computed(() => resolutionFactor.value === 0.25),
		action: () => resolutionFactor.value = 0.25,
	}], ev.currentTarget ?? ev.target);
}

function openMotionBlurSamplesMenu(ev: PointerEvent) {
	ui.popupMenu(TIMELINE_PREVIEW_MOTION_BLUR_SAMPLE_OPTIONS.map(samples => ({
		type: 'radioOption' as const,
		text: samples === 0 ? i18n.ts.Off : String(samples),
		active: computed(() => timelinePreviewMotionBlurSamples.value === samples),
		action: () => { timelinePreviewMotionBlurSamples.value = samples; },
	})), ev.currentTarget ?? ev.target);
}

function openFpsMenu(ev: PointerEvent) {
	if (previewPlayback.state.value.mode === 'timeline') {
		ui.popupMenu([2, 1, 0.5, 0.25].map(factor => ({
			type: 'radioOption' as const,
			text: factor + 'x (' + stateManager.state.timelineFps.value * factor + 'fps)',
			active: computed(() => timelinePreviewFpsFactor.value === factor),
			action: () => { timelinePreviewFpsFactor.value = factor; },
		})), ev.currentTarget ?? ev.target);
		return;
	}
	ui.popupMenu([{
		type: 'radioOption',
		text: i18n.ts._App.UnlimitedVisualModuleLivePreview,
		active: computed(() => visualModuleLivePreviewFpsLimit.value === null),
		action: () => visualModuleLivePreviewFpsLimit.value = null,
	}, {
		type: 'radioOption',
		text: i18n.ts._App.VisualModuleLivePreview120fps,
		active: computed(() => visualModuleLivePreviewFpsLimit.value === 120),
		action: () => visualModuleLivePreviewFpsLimit.value = 120,
	}, {
		type: 'radioOption',
		text: i18n.ts._App.VisualModuleLivePreview60fps,
		active: computed(() => visualModuleLivePreviewFpsLimit.value === 60),
		action: () => visualModuleLivePreviewFpsLimit.value = 60,
	}, {
		type: 'radioOption',
		text: i18n.ts._App.VisualModuleLivePreview30fps,
		active: computed(() => visualModuleLivePreviewFpsLimit.value === 30),
		action: () => visualModuleLivePreviewFpsLimit.value = 30,
	}, {
		type: 'radioOption',
		text: i18n.ts._App.VisualModuleLivePreview15fps,
		active: computed(() => visualModuleLivePreviewFpsLimit.value === 15),
		action: () => visualModuleLivePreviewFpsLimit.value = 15,
	}], ev.currentTarget ?? ev.target);
}

function openHeaderFileMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: i18n.ts._Dashboard.NewProject,
		icon: 'ti ti-plus',
		action: () => { void newProject(); },
	}, {
		text: `${i18n.ts._Dashboard.OpenMedia}...`,
		icon: 'ti ti-photo-video',
		action: () => { void newProjectFromImageOrVideo(); },
	}, {
		text: `${i18n.ts._App.Open}...`,
		icon: 'ti ti-folder-open',
		action: () => { void openProject(); },
	}, {
		text: i18n.ts.Save,
		icon: 'ti ti-device-floppy',
		action: () => { void projectSession.saveProject(); },
	}, {
		text: `${i18n.ts._App.SaveAs}...`,
		icon: 'ti ti-device-floppy',
		action: () => { void projectSession.saveProject(true); },
	}, {
		text: i18n.ts._App.CloseProject,
		icon: 'ti ti-x',
		action: () => { void projectSessions.close(projectSession); },
	}, {
		type: 'divider',
	}, {
		type: 'parent',
		text: i18n.ts.Import,
		icon: 'ti ti-upload',
		children: [{
			text: i18n.ts._App.ImportVisualModule,
			icon: 'ti ti-box-multiple',
			action: () => { void importVisualModuleFile(projectSession.projectContext); },
		}],
	}, {
		text: `${i18n.ts._App.SavePreviewSnapshot}...`,
		icon: 'ti ti-photo',
		action: () => {
			savePreviewSnapshot();
		},
	}, {
		text: `${i18n.ts._App.ExportScene}...`,
		icon: 'ti ti-movie',
		action: () => {
			const { dispose } = ui.popup(GsTimelineExportDialog, {}, { closed: () => dispose() }, projectSession);
		},
	}], ev.currentTarget ?? ev.target);
}

function openHeaderEditMenu(ev: PointerEvent) {
	ui.popupMenu([{
		id: 'reset-render-history',
		text: i18n.ts._App.ResetRenderHistory,
		icon: 'ti ti-refresh',
		action: () => previewPlayback.resetRenderHistory(),
	}, {
		type: 'divider',
	}, {
		text: `${i18n.ts._App.ProjectSettings}...`,
		icon: 'ti ti-file-settings',
		action: openProjectSettings,
	}, {
		text: `${i18n.ts._App.Preferences}...`,
		icon: 'ti ti-settings',
		action: openPreferences,
	}], ev.currentTarget ?? ev.target);
}

async function changeZoom(direction: 'in' | 'out') {
	if (!__ELECTRON__) return;
	if (!window.desktop) throw new Error('Desktop API is unavailable');
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

function openWorkspacePanelWindow(contentType: WorkspacePanel['contentType']) {
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
	ui.popupMenu(workspacePanelChoices.map(({ type, label, icon }) => ({
		text: label,
		icon,
		action: () => openWorkspacePanelWindow(type),
	})), ev.currentTarget ?? ev.target);
}

function openHeaderToolsMenu(ev: PointerEvent) {
}

async function toggleDevTools() {
	if (!__ELECTRON__) return;
	if (!window.desktop) throw new Error('Desktop API is unavailable');
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
.root {
	position: absolute;
	display: flex;
	flex-direction: column;
	box-sizing: border-box;
	height: 100%;
	width: 100%;
	overflow: clip;
}

.headerLeft {
	display: flex;
	flex-shrink: 0;
	align-items: center;
}

.headerCenter {
	flex: 1;
	min-width: 0;
	text-align: center;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.headerRight {
	margin-left: auto;
	min-width: 0;
	padding: 0 12px;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.headerDivider {
	width: 1px;
	height: 50%;
	margin: 0 4px;
	background-color: #fff2;
}

.projectFileName {
	margin-left: 0.5em;
	color: color-mix(in srgb, var(--THEME-fg), transparent 30%);
}

.projectSaving {
	margin-right: 1em;
	color: var(--THEME-accent);
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

.body {
	display: flex;
	flex: 2;
	min-height: 0;
	margin: 0 8px;
	padding: 4px;
	background: var(--THEME-globalBg);
	border-radius: 8px;
}

.footer {
	display: flex;
	height: 28px;
	box-sizing: border-box;
	line-height: 28px;
	font-size: 95%;
	padding: 0 12px;
}

.footerLeft {
	display: flex;
	gap: 0.5em;
}

.footerRight {
	display: flex;
	margin-left: auto;
	gap: 16px;
}

.footerSection {
	display: flex;
	padding: 0 1em;
}

.footerSectionTitle {
	font-weight: bold;
}

.footerSectionContents {
	display: flex;
}

.footerItem {
	padding: 0 1em;

	&:hover {
		background: #fff1;
	}
}

.footerError {
	color: var(--THEME-error);
}

.footerStats {
	display: flex;
	gap: 8px;
}

.previewVolume {
	display: flex;
	align-items: center;
	gap: 6px;
	margin: 0 16px;
	min-width: 0;

}

.outputLevelMeter {
	align-self: center;
	flex: 0 0 100px;
	height: 14px;
}

.volumeValue {
	min-width: 4ch;
	text-align: right;
	font-variant-numeric: tabular-nums;
}

.footerStatsItem {
	min-width: 4em;
}

.footerMemory {
	white-space: nowrap;
	font-variant-numeric: tabular-nums;
}


</style>
