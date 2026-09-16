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
		<button class="_button" :class="$style.undoRedo" :disabled="!appContext.canUndo.value" @click="appContext.undo"><i class="ti ti-arrow-back-up"></i></button>
		<button class="_button" :class="$style.undoRedo" :disabled="!appContext.canRedo.value" @click="appContext.redo"><i class="ti ti-arrow-forward-up"></i></button>
		<button class="_button" @click="exportToWebp">export</button>
		<button class="_button" @click="showAbout">about</button>
	</div>
	<div :class="$style.body">
		<GsWorkspaceElement style="flex: 1" :element="preferences.r.workspaceDefinition.value"/>
	</div>
	<div :class="$style.footer">
		<div :class="$style.footerLeft">
			<div>sRGB</div>
			<div @click="openResolutionMenu">{{ appContext.state.resolution.value.width }} x {{ appContext.state.resolution.value.height }} px ({{ resolutionFactor }}x) | {{ Math.round(engine.fpsDisplay.value) }}fps</div>
			<div @click="openTimeFactorMenu">TIME: {{ timeFactor }}x</div>
			<div :class="$style.previewVolume">
				<i :class="previewVolume === 0 ? 'ti ti-volume-off' : 'ti ti-volume'"></i>
				<GsRange v-model="previewVolume" :min="0" :max="1" :step="0.01" :continuousUpdate="true" style="width: 150px;"/>
				<span :class="$style.volumeValue">{{ Math.round(previewVolume * 100) }}%</span>
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
import { engine, resolutionFactor, fpsLimit, timeFactor, appContext } from './app';
import { preferences } from './preferences.ts';
import GsRange from './components/common/GsRange.vue';
import GsAboutDialog from '@/components/GsAboutDialog.vue';
import GsDashboardDialog from '@/components/GsDashboardDialog.vue';
import GsWorkspaceElement from '@/components/GsWorkspaceElement.vue';
import { i18n } from '@/i18n.ts';
import GsButton from '@/components/common/GsButton.vue';
import GsAudioLevelMeter from '@/components/common/GsAudioLevelMeter.vue';
import * as ui from '@/ui.ts';

const releaseOutputCapture = engine.retainAudioOutputCapture();
onBeforeUnmount(releaseOutputCapture);

const previewVolume = preferences.model('previewVolume');
watch(previewVolume, (newValue) => {
	engine.setPreviewVolume(newValue);
}, { immediate: true });

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

function openTimeFactorMenu(ev: PointerEvent) {
	ui.popupMenu([{
		type: 'radio',
		text: 'Time Factor',
		caption: timeFactor.value + 'x',
		options: [{
			label: '-1x',
			value: -1,
		}, {
			label: '0x',
			value: 0,
		}, {
			label: '0.5x',
			value: 0.5,
		}, {
			label: '1x',
			value: 1,
		}, {
			label: '2x',
			value: 2,
		}],
		ref: timeFactor,
	}], ev.currentTarget ?? ev.target);
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
	box-sizing: border-box;
	height: 100%;
	width: 100%;
	overflow: clip;
}

.header {
	display: flex;
	height: 32px;
	line-height: 32px;
	gap: 16px;
}

.undoRedo {
	&:disabled {
		// opacityはブラウザにとって高コストなので
		color: color-mix(in srgb, var(--THEME-fg), var(--THEME-bg) 50%);
	}
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
	gap: 16px;
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
