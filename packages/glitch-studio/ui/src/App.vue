<template>
<component
	:is="popup.component"
	v-for="popup in ui.popups.value"
	:key="popup.id"
	v-bind="popup.props"
	v-on="popup.events"
/>

<div :class="$style.root">
	<div :class="$style.header">
		<div :class="$style.headerLeft">
			<button class="_button" :class="$style.undoRedo" :disabled="!stateManager.canUndo.value" @click="stateManager.undo()"><i class="ti ti-arrow-back-up"></i></button>
			<button class="_button" :class="$style.undoRedo" :disabled="!stateManager.canRedo.value" @click="stateManager.redo()"><i class="ti ti-arrow-forward-up"></i></button>
			<button class="_button" :class="$style.headerMenuItem" @click="openHeaderFileMenu">File</button>
			<button class="_button" :class="$style.headerMenuItem" @click="openHeaderEditMenu">Edit</button>
			<button class="_button" :class="$style.headerMenuItem" @click="openHeaderViewMenu">View</button>
			<button class="_button" :class="$style.headerMenuItem" @click="openHeaderHelpMenu">Help</button>
		</div>
		<div :class="$style.headerCenter">
			{{ projectName }}
			<span v-if="projectFileName" :class="$style.projectFileName">({{ projectFileName }})</span>
		</div>
		<div :class="$style.headerRight">
			Glitch Studio
		</div>
	</div>
	<div :class="$style.body">
		<GsWorkspaceElement style="flex: 1" :element="preferences.r.workspaceDefinition.value"/>
	</div>
	<div :class="$style.footer" class="_monospace">
		<div :class="$style.footerLeft">
			<div :class="$style.footerSection">
				<div :class="$style.footerSectionTitle">Project:</div>
				<div :class="$style.footerSectionContents">
					<button :class="$style.footerItem" class="_button" @click="openProjectSettings">sRGB / {{ stateManager.state.resolution.value.width }} x {{ stateManager.state.resolution.value.height }} px / {{ stateManager.state.timelineFps.value }}fps</button>
				</div>
			</div>
			<div :class="$style.footerSection">
				<div :class="$style.footerSectionTitle">Preview:</div>
				<div :class="$style.footerSectionContents">
					<button :class="$style.footerItem" class="_button" @click="openResolutionFactorMenu">{{ Math.round(stateManager.state.resolution.value.width * resolutionFactor) }} x {{ Math.round(stateManager.state.resolution.value.height * resolutionFactor) }} px ({{ resolutionFactor }}x)</button>
					<button v-if="previewPlayback.state.value.mode === 'timeline' && stateManager.state.timelineMotionBlur.value.enabled" :class="$style.footerItem" class="_button" title="Preview motion blur samples. Requires motion blur to be enabled in Project Settings." @click="openMotionBlurSamplesMenu">Motion blur: {{ timelinePreviewMotionBlurSamples === 0 ? 'Off' : `${timelinePreviewMotionBlurSamples} samples` }}</button>
					<button :class="$style.footerItem" class="_button" @click="openFpsMenu">{{ previewPlayback.state.value.mode === 'live' ? `${Math.round(visualModuleRendererManagerController.fpsDisplay.value)}fps` : `${stateManager.state.timelineFps.value * timelinePreviewFpsFactor}fps (${timelinePreviewFpsFactor}x)` }}</button>
					<button v-if="previewPlayback.state.value.mode === 'live'" :class="$style.footerItem" class="_button" @click="openTimeFactorMenu">TIME: {{ liveTimeFactor }}x</button>
					<div :class="[$style.footerItem, $style.previewVolume]">
						<i :class="previewVolume === 0 ? 'ti ti-volume-off' : 'ti ti-volume'"></i>
						<GsRange v-model="previewVolume" :min="0" :max="1" :step="0.01" :continuousUpdate="true" style="width: 150px;"/>
						<span :class="$style.volumeValue">{{ Math.round(previewVolume * 100) }}%</span>
					</div>
				</div>
			</div>
		</div>
		<div :class="$style.footerRight">
			<button v-if="preferences.r.projectBackups.value.autoEnabled || preferences.r.projectBackups.value.saveEnabled" class="_button" :class="$style.footerItem" :title="projectBackupStatus.error ?? 'Project backup preferences and status'" @click="openPreferences">{{ projectBackupStatus.error ? 'Backup error' : projectBackupAccess === 'ready' ? 'Backups' : projectBackupAccess === 'unsaved' ? 'Backups: save project first' : 'Backups: folder access required' }}</button>
			<div v-if="activePreviewRenderer.errorMessage.value != null" v-tooltip="activePreviewRenderer.errorMessage.value" :class="$style.footerError"><i class="ti ti-alert-triangle"></i> {{ activePreviewRenderer.errorMessage.value }}</div>
			<div :class="$style.footerStats">
				<div v-if="previewPlayback.state.value.mode === 'live' && visualModuleRendererManagerController.gpuMemoryUsage.value" v-tooltip="gpuMemoryTooltip" :class="$style.footerMemory">{{ (visualModuleRendererManagerController.gpuMemoryUsage.value.total / 1000 ** 2).toFixed(1) }} MB</div>
			</div>
			<div :class="$style.outputLevelMeter">
				<GsAudioLevelMeter :levels="audioOutput.outputLevels"/>
			</div>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { provide, computed, nextTick, onMounted, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { appContext, openProject } from './app.ts';
import { TIMELINE_PREVIEW_MOTION_BLUR_SAMPLE_OPTIONS } from './AppContext.ts';
import { preferences } from './preferences.ts';
import { WorkspaceController, workspaceControllerKey } from './WorkspaceController.ts';
import { desktopProjectFile } from './gsproj.ts';
import { importVisualModuleFile } from './utility/visual-module-file.ts';
import GsRange from './components/common/GsRange.vue';
import GsAboutDialog from '@/components/GsAboutDialog.vue';
import GsProjectSettingsDialog from '@/components/GsProjectSettingsDialog.vue';
import GsSettingsDialog from '@/components/GsSettingsDialog.vue';
import GsTimelineExportDialog from '@/components/GsTimelineExportDialog.vue';
import GsDashboardDialog from '@/components/GsDashboardDialog.vue';
import GsWorkspaceElement from '@/components/GsWorkspaceElement.vue';
import { i18n } from '@/i18n.ts';
import GsButton from '@/components/common/GsButton.vue';
import GsAudioLevelMeter from '@/components/common/GsAudioLevelMeter.vue';
import * as ui from '@/ui.ts';

provide(workspaceControllerKey, new WorkspaceController(preferences.r.workspaceDefinition, root => preferences.commit('workspaceDefinition', root)));

const { audioOutput, activePreviewRenderer, previewPlayback, visualModuleRendererManagerController, resolutionFactor, liveFpsLimit, timelinePreviewFpsFactor, timelinePreviewMotionBlurSamples, liveTimeFactor, projectBackupAccess, projectBackupStatus } = appContext;
const { stateManager } = appContext.projectContext;
const { name: projectName } = appContext.projectContext.stateManager.state;
const { projectFileName } = appContext;

const releaseOutputCapture = audioOutput.retainOutputCapture();
onBeforeUnmount(releaseOutputCapture);

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

async function saveImage() {

}

async function saveAnimation() {
	/*
	const dirPath = await api.selectDirectory({
	});
	if (dirPath == null) return;

	frame.value = 0;

	for (let i = 0; i <= frameMax.value; i++) {
		console.log(`${i} of ${frameMax.value}`);
		const path = `${dirPath}/${i.toString().padStart(4, '0')}.png`;

		await new Promise(resolve => {
			canvas.value!.toBlob(async blob => {
				api.saveFile(path, await blob.arrayBuffer()).then(resolve);
			});
		});
	}
		*/
}

async function saveAnimationGif() {

}

async function importPreset() {
	/*
	const result = await api.openPresetFile({});
	if (result == null) return;

	const assets = await api.decodeAssets(result.preset.assets);

	for (const asset of assets) {
		stateManager.commit('addAsset', asset);
	}

	for (const node of result.preset.nodes) {
		store.nodes.push(node);
	}
		*/
}

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
		active: computed(() => liveTimeFactor.value === -1),
		action: () => liveTimeFactor.value = -1,
	}, {
		type: 'radioOption',
		text: '0x',
		active: computed(() => liveTimeFactor.value === 0),
		action: () => liveTimeFactor.value = 0,
	}, {
		type: 'radioOption',
		text: '0.5x',
		active: computed(() => liveTimeFactor.value === 0.5),
		action: () => liveTimeFactor.value = 0.5,
	}, {
		type: 'radioOption',
		text: '1x',
		active: computed(() => liveTimeFactor.value === 1),
		action: () => liveTimeFactor.value = 1,
	}, {
		type: 'radioOption',
		text: '2x',
		active: computed(() => liveTimeFactor.value === 2),
		action: () => liveTimeFactor.value = 2,
	}], ev.currentTarget ?? ev.target);
}

function openProjectSettings() {
	const { dispose } = ui.popup(GsProjectSettingsDialog, {}, { closed: () => dispose() });
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
		text: samples === 0 ? 'Off' : String(samples),
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
		text: 'LIVE: Unlimited',
		active: computed(() => liveFpsLimit.value === null),
		action: () => liveFpsLimit.value = null,
	}, {
		type: 'radioOption',
		text: 'LIVE: 120fps',
		active: computed(() => liveFpsLimit.value === 120),
		action: () => liveFpsLimit.value = 120,
	}, {
		type: 'radioOption',
		text: 'LIVE: 60fps',
		active: computed(() => liveFpsLimit.value === 60),
		action: () => liveFpsLimit.value = 60,
	}, {
		type: 'radioOption',
		text: 'LIVE: 30fps',
		active: computed(() => liveFpsLimit.value === 30),
		action: () => liveFpsLimit.value = 30,
	}, {
		type: 'radioOption',
		text: 'LIVE: 15fps',
		active: computed(() => liveFpsLimit.value === 15),
		action: () => liveFpsLimit.value = 15,
	}], ev.currentTarget ?? ev.target);
}

function openHeaderFileMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: 'Open...',
		icon: 'ti ti-folder-open',
		action: () => { void openProject(); },
	}, {
		text: 'Save',
		icon: 'ti ti-device-floppy',
		action: () => { void appContext.saveProject(); },
	}, {
		text: 'Save as...',
		icon: 'ti ti-device-floppy',
		action: () => { void appContext.saveProject(true); },
	}, {
		type: 'divider',
	}, {
		type: 'parent',
		text: 'Import',
		icon: 'ti ti-upload',
		children: [{
			text: 'Visual Module (.gsvm)',
			icon: 'ti ti-box-multiple',
			action: () => { void importVisualModuleFile(appContext.projectContext); },
		}],
	}, {
		text: 'Save Preview Snapshot...',
		icon: 'ti ti-photo',
		action: () => {
			savePreviewSnapshot();
		},
	}, {
		text: 'Export Scene...',
		icon: 'ti ti-movie',
		action: () => {
			const { dispose } = ui.popup(GsTimelineExportDialog, {}, { closed: () => dispose() });
		},
	}], ev.currentTarget ?? ev.target);
}

function openHeaderEditMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: 'Project Settings...',
		icon: 'ti ti-file-settings',
		action: openProjectSettings,
	}, {
		text: 'Preferences...',
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
	ui.popupMenu(__ELECTRON__ ? [{
		text: 'Zoom In',
		icon: 'ti ti-zoom-in',
		action: () => { void changeZoom('in'); },
	}, {
		text: 'Zoom Out',
		icon: 'ti ti-zoom-out',
		action: () => { void changeZoom('out'); },
	}] : [], ev.currentTarget ?? ev.target);
}

async function toggleDevTools() {
	if (!__ELECTRON__) return;
	if (!window.desktop) throw new Error('Desktop API is unavailable');
	await window.desktop.toggleDevTools();
}

function openHeaderHelpMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: 'About',
		icon: 'ti ti-info-circle',
		action: () => {
			showAbout();
		},
	}, ...(__ELECTRON__ ? [{
		text: 'Toggle Developer Tools',
		action: () => { void toggleDevTools(); },
	}] : [])], ev.currentTarget ?? ev.target);
}

onMounted(async () => {
	try {
		const startupProject = await window.desktop?.takeStartupProjectFile();
		if (startupProject && await openProject(undefined, desktopProjectFile(startupProject))) return;
	} catch (error) {
		console.error(error);
		await ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
	}
	// 通常起動時と読込失敗時には、別のプロジェクトを選べるようにする。
	const { dispose } = ui.popup(GsDashboardDialog, {}, {
		closed: () => dispose(),
	});
});
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

.header {
	display: flex;
	height: 32px;
	line-height: 32px;
	box-sizing: border-box;

	padding-left: env(titlebar-area-x, 0);
	width: env(titlebar-area-width, 100%);
	app-region: drag;
}

.headerLeft {
	display: flex;
	flex-shrink: 0;
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

.projectFileName {
	margin-left: 0.5em;
	color: color-mix(in srgb, var(--THEME-fg), var(--THEME-bg) 30%);
}

.undoRedo {
	padding: 0 8px;
	app-region: no-drag;

	&:disabled {
		// opacityはブラウザにとって高コストなので
		color: color-mix(in srgb, var(--THEME-fg), var(--THEME-bg) 50%);
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
	padding: 0 8px;
}

.footer {
	display: flex;
	height: 28px;
	box-sizing: border-box;
	line-height: 28px;
	font-size: 90%;
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
	margin-bottom: 0.5em;
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

	input {
		width: 120px;
		min-width: 40px;
		margin: 0;
		accent-color: var(--THEME-accent);
	}
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

body > .titlebar.inactive + div {
	background: #2c2c2c;
}

</style>
