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
			<button class="_button" :class="$style.undoRedo" :disabled="!appStateManager.canUndo.value" @click="appStateManager.undo"><i class="ti ti-arrow-back-up"></i></button>
			<button class="_button" :class="$style.undoRedo" :disabled="!appStateManager.canRedo.value" @click="appStateManager.redo"><i class="ti ti-arrow-forward-up"></i></button>
			<button class="_button" :class="$style.headerMenuItem" @click="openHeaderFileMenu">File</button>
			<button class="_button" :class="$style.headerMenuItem" @click="openHeaderEditMenu">Edit</button>
			<button class="_button" :class="$style.headerMenuItem" @click="openHeaderViewMenu">View</button>
			<button class="_button" :class="$style.headerMenuItem" @click="openHeaderHelpMenu">Help</button>
		</div>
		<div :class="$style.headerRight" :title="projectInfo.name">
			{{ projectInfo.name }}
		</div>
	</div>
	<div :class="$style.body">
		<GsWorkspaceElement style="flex: 1" :element="preferences.r.workspaceDefinition.value"/>
	</div>
	<div :class="$style.footer" class="_monospace">
		<div :class="$style.footerLeft">
			<div :class="$style.footerItem">sRGB</div>
			<button :class="$style.footerItem" class="_button" @click="openProjectSettings">Proj: {{ appStateManager.state.resolution.value.width }} x {{ appStateManager.state.resolution.value.height }} px</button>
			<button :class="$style.footerItem" class="_button" @click="openResolutionFactorMenu">Preview: {{ resolutionFactor }}x ({{ Math.round(appStateManager.state.resolution.value.width * resolutionFactor) }} x {{ Math.round(appStateManager.state.resolution.value.height * resolutionFactor) }} px)</button>
			<button :class="$style.footerItem" class="_button" @click="openFpsMenu">{{ previewPlayback.state.value.mode === 'live' ? `${Math.round(visualModuleRendererManagerController.fpsDisplay.value)}fps` : `FPS limit: ${fpsLimit ?? 'Unlimited'}` }}</button>
			<button v-if="previewPlayback.state.value.mode === 'live'" :class="$style.footerItem" class="_button" @click="openTimeFactorMenu">TIME: {{ liveTimeFactor }}x</button>
			<div :class="[$style.footerItem, $style.previewVolume]">
				<i :class="previewVolume === 0 ? 'ti ti-volume-off' : 'ti ti-volume'"></i>
				<GsRange v-model="previewVolume" :min="0" :max="1" :step="0.01" :continuousUpdate="true" style="width: 150px;"/>
				<span :class="$style.volumeValue">{{ Math.round(previewVolume * 100) }}%</span>
			</div>
		</div>
		<div :class="$style.footerRight">
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
import { computed, nextTick, onMounted, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { audioOutput, activePreviewRenderer, previewPlayback, visualModuleRendererManagerController, resolutionFactor, fpsLimit, liveTimeFactor, appStateManager, projectInfo, openProject, saveProject } from './app.ts';
import { preferences } from './preferences.ts';
import GsRange from './components/common/GsRange.vue';
import GsAboutDialog from '@/components/GsAboutDialog.vue';
import GsProjectSettingsDialog from '@/components/GsProjectSettingsDialog.vue';
import GsTimelineExportDialog from '@/components/GsTimelineExportDialog.vue';
import GsDashboardDialog from '@/components/GsDashboardDialog.vue';
import GsWorkspaceElement from '@/components/GsWorkspaceElement.vue';
import { i18n } from '@/i18n.ts';
import GsButton from '@/components/common/GsButton.vue';
import GsAudioLevelMeter from '@/components/common/GsAudioLevelMeter.vue';
import * as ui from '@/ui.ts';

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
		appContext.commit('addAsset', asset);
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

function openFpsMenu(ev: PointerEvent) {
	ui.popupMenu([{
		type: 'radioOption',
		text: 'Max',
		active: computed(() => fpsLimit.value === null),
		action: () => fpsLimit.value = null,
	}, {
		type: 'radioOption',
		text: '120fps',
		active: computed(() => fpsLimit.value === 120),
		action: () => fpsLimit.value = 120,
	}, {
		type: 'radioOption',
		text: '60fps',
		active: computed(() => fpsLimit.value === 60),
		action: () => fpsLimit.value = 60,
	}, {
		type: 'radioOption',
		text: '30fps',
		active: computed(() => fpsLimit.value === 30),
		action: () => fpsLimit.value = 30,
	}, {
		type: 'radioOption',
		text: '15fps',
		active: computed(() => fpsLimit.value === 15),
		action: () => fpsLimit.value = 15,
	}], ev.currentTarget ?? ev.target);
}

function openHeaderFileMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: 'Open...',
		action: () => { void openProject(); },
	}, {
		text: 'Save',
		action: () => { void saveProject(); },
	}, {
		text: 'Save as...',
		action: () => { void saveProject(true); },
	}, {
		type: 'divider',
	}, {
		text: 'Save Preview Snapshot...',
		action: () => {
			savePreviewSnapshot();
		},
	}, {
		text: 'Export Scene...',
		action: () => {
			const { dispose } = ui.popup(GsTimelineExportDialog, {}, { closed: () => dispose() });
		},
	}], ev.currentTarget ?? ev.target);
}

function openHeaderEditMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: 'Project Settings',
		action: openProjectSettings,
	}], ev.currentTarget ?? ev.target);
}

async function changeZoom(direction: 'in' | 'out') {
	if (!__ELECTRON__) return;
	try {
		if (!window.desktop) throw new Error('Desktop API is unavailable');
		if (direction === 'in') {
			await window.desktop.zoomIn();
		} else {
			await window.desktop.zoomOut();
		}
	} catch (error) {
		await ui.alert({ type: 'error', title: '拡大率を変更できませんでした', text: String(error) });
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
	try {
		if (!window.desktop) throw new Error('Desktop API is unavailable');
		await window.desktop.toggleDevTools();
	} catch (error) {
		await ui.alert({ type: 'error', title: '開発者ツールの表示を切り替えられませんでした', text: String(error) });
	}
}

function openHeaderHelpMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: 'About',
		action: () => {
			showAbout();
		},
	}, ...(__ELECTRON__ ? [{
		text: 'Toggle Developer Tools',
		action: () => { void toggleDevTools(); },
	}] : [])], ev.currentTarget ?? ev.target);
}

onMounted(() => {
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

.headerRight {
	margin-left: auto;
	min-width: 0;
	padding: 0 12px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
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
	height: 32px;
	box-sizing: border-box;
	line-height: 32px;
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
