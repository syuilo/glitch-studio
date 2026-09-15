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
		<button class="_button" @click="exportToWebp">export</button>
		<button class="_button" @click="showAbout">about</button>
	</div>
	<div :class="$style.body">
		<GsWorkspaceDivider style="flex: 1" :divider="prefer.r.workspaceDefinition.value"/>
	</div>
	<div :class="$style.footer">
		<div :class="$style.footerLeft">
			<div @click="openResolutionMenu">{{ appContext.state.resolution.value.width }} x {{ appContext.state.resolution.value.height }} px ({{ resolutionFactor }}x) | {{ Math.round(engine.fpsDisplay.value) }}fps</div>
			<div :class="$style.previewVolume">
				<i :class="engine.previewVolume.value === 0 ? 'ti ti-volume-off' : 'ti ti-volume'"></i>
				<span>Preview</span>
				<input type="range" min="0" max="1" step="0.01" :value="engine.previewVolume.value" @input="setPreviewVolume">
				<span :class="$style.volumeValue">{{ Math.round(engine.previewVolume.value * 100) }}%</span>
			</div>
		</div>
		<div :class="$style.footerRight">
			<div :class="$style.footerStats">
				<div :class="$style.footerStatsItem">{{ (engine.gpuAverageDisplayFast.value / 1000).toFixed(1) }}ms</div>
				<div :class="$style.footerStatsItem">{{ (engine.gpuAverageDisplayMedium.value / 1000).toFixed(1) }}ms</div>
				<div :class="$style.footerStatsItem">{{ (engine.gpuAverageDisplaySlow.value / 1000).toFixed(1) }}ms</div>
				<div v-if="engine.gpuMemoryUsage.value" v-tooltip="gpuMemoryTooltip" :class="$style.footerMemory">{{ (engine.gpuMemoryUsage.value.total / 1000 ** 2).toFixed(1) }} MB</div>
			</div>
			<div :class="$style.outputLevelMeter">
				<GsAudioLevelMeter :levels="engine.audioOutputLevels"/>
			</div>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { engine, resolutionFactor, fpsLimit, appContext } from './app';
import { prefer } from './preferences.ts';
import GsAboutDialog from '@/components/GsAboutDialog.vue';
import GsDashboardDialog from '@/components/GsDashboardDialog.vue';
import GsWorkspaceDivider from '@/components/GsWorkspaceDivider.vue';
import { i18n } from '@/i18n.ts';
import GsButton from '@/components/common/GsButton.vue';
import GsAudioLevelMeter from '@/components/common/GsAudioLevelMeter.vue';
import * as ui from '@/ui.ts';

const presetName = '';

const releaseOutputCapture = engine.retainAudioOutputCapture();
onBeforeUnmount(releaseOutputCapture);

function setPreviewVolume(event: Event) {
	engine.setPreviewVolume((event.target as HTMLInputElement).valueAsNumber);
}

const gpuMemoryTooltip = computed(() => {
	const usage = engine.gpuMemoryUsage.value;
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
	engine.canvas.toBlob((blob) => {
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

function openResolutionMenu(ev: PointerEvent) {
	ui.popupMenu([{
		type: 'radio',
		text: 'FPS Limitation',
		caption: fpsLimit.value == null ? 'Max' : `~${fpsLimit.value}fps`,
		options: [{
			label: 'Max',
			value: null,
		}, {
			label: '~120fps',
			value: 120,
		}, {
			label: '~60fps',
			value: 60,
		}, {
			label: '~30fps',
			value: 30,
		}, {
			label: '~15fps',
			value: 15,
		}],
		ref: fpsLimit,
	}, {
		type: 'radio',
		text: 'Resolution',
		caption: resolutionFactor.value + 'x',
		options: [{
			label: '4x',
			value: 4,
		}, {
			label: '2x',
			value: 2,
		}, {
			label: '1x',
			value: 1,
		}, {
			label: '0.5x',
			value: 0.5,
		}, {
			label: '0.25x',
			value: 0.25,
		}],
		ref: resolutionFactor,
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
	gap: 4px;
	box-sizing: border-box;
	height: 100%;
	width: 100%;
	overflow: clip;
}

.header {
	display: flex;
	height: 32px;
	line-height: 32px;
	background: var(--THEME-workspacePanelBody);
	gap: 16px;
}

.body {
	display: flex;
	flex: 2;
	min-height: 0;
}

.footer {
	display: flex;
	height: 32px;
	box-sizing: border-box;
	line-height: 32px;
	font-size: 90%;
	padding: 0 12px;
	background: var(--THEME-workspacePanelBody);
}

.footerLeft {
	display: flex;
}

.footerRight {
	display: flex;
	margin-left: auto;
	gap: 16px;
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
