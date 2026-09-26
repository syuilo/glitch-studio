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
			<button :class="$style.footerItem" class="_button" @click="openResolutionMenu">Proj: {{ appStateManager.state.resolution.value.width }} x {{ appStateManager.state.resolution.value.height }} px</button>
			<button :class="$style.footerItem" class="_button" @click="openResolutionFactorMenu">Preview: {{ resolutionFactor }}x ({{ Math.round(appStateManager.state.resolution.value.width * resolutionFactor) }} x {{ Math.round(appStateManager.state.resolution.value.height * resolutionFactor) }} px)</button>
			<button :class="$style.footerItem" class="_button" @click="openFpsMenu">{{ Math.round(renderer.fpsDisplay.value) }}fps</button>
			<button :class="$style.footerItem" class="_button" @click="openTimeFactorMenu">TIME: {{ liveTimeFactor }}x</button>
			<div :class="[$style.footerItem, $style.previewVolume]">
				<i :class="previewVolume === 0 ? 'ti ti-volume-off' : 'ti ti-volume'"></i>
				<GsRange v-model="previewVolume" :min="0" :max="1" :step="0.01" :continuousUpdate="true" style="width: 150px;"/>
				<span :class="$style.volumeValue">{{ Math.round(previewVolume * 100) }}%</span>
			</div>
		</div>
		<div :class="$style.footerRight">
			<div v-if="renderer.errorMessage.value != null" v-tooltip="renderer.errorMessage.value" :class="$style.footerError"><i class="ti ti-alert-triangle"></i> {{ renderer.errorMessage.value }}</div>
			<div :class="$style.footerStats">
				<div v-if="renderer.gpuMemoryUsage.value" v-tooltip="gpuMemoryTooltip" :class="$style.footerMemory">{{ (renderer.gpuMemoryUsage.value.total / 1000 ** 2).toFixed(1) }} MB</div>
			</div>
			<div :class="$style.outputLevelMeter">
				<GsAudioLevelMeter :levels="renderer.audioOutputLevels"/>
			</div>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { renderer, resolutionFactor, fpsLimit, liveTimeFactor, appStateManager, projectInfo, openProject, saveProject } from './app';
import { preferences } from './preferences.ts';
import GsRange from './components/common/GsRange.vue';
import GsAboutDialog from '@/components/GsAboutDialog.vue';
import GsTimelineExportDialog from '@/components/GsTimelineExportDialog.vue';
import GsDashboardDialog from '@/components/GsDashboardDialog.vue';
import GsWorkspaceElement from '@/components/GsWorkspaceElement.vue';
import { i18n } from '@/i18n.ts';
import GsButton from '@/components/common/GsButton.vue';
import GsAudioLevelMeter from '@/components/common/GsAudioLevelMeter.vue';
import * as ui from '@/ui.ts';

const releaseOutputCapture = renderer.retainAudioOutputCapture();
onBeforeUnmount(releaseOutputCapture);

const previewVolume = preferences.model('previewVolume');
watch(previewVolume, (newValue) => {
	renderer.setPreviewVolume(newValue);
}, { immediate: true });

const gpuMemoryTooltip = computed(() => {
	const usage = renderer.gpuMemoryUsage.value;
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

function exportToWebp() {
	// TODO: 元の解像度にリサイズしてからエクスポートする
	renderer.canvas.toBlob((blob) => {
		if (blob == null) return;
		const url = URL.createObjectURL(blob);

		const link = window.document.createElement('a');
		link.href = url;
		link.download = `${Date.now()}.webp`;
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

function openResolutionMenu(ev: PointerEvent) {
	// TODO
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
		text: 'Export',
		action: () => {
			exportToWebp();
		},
	}, {
		text: 'Export Timeline As Video...',
		action: () => {
			const { dispose } = ui.popup(GsTimelineExportDialog, {}, { closed: () => dispose() });
		},
	}], ev.currentTarget ?? ev.target);
}

function openHeaderEditMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: 'Change Project Resolution',
		action: () => {
			// TODO
		},
	}], ev.currentTarget ?? ev.target);
}

function openHeaderHelpMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: 'About',
		action: () => {
			showAbout();
		},
	}], ev.currentTarget ?? ev.target);
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
