<template>
<GsDetachableView title="Preview">
	<div :class="$style.root" @dragover.prevent.stop @drop.prevent.stop="onDrop">
		<div :class="$style.topLeft">
			<div v-if="showTimecodeInPreview" :class="$style.time" class="_monospace">{{ formatTime(time) }}</div>
		</div>
		<div :class="$style.topRight">
			<div :class="$style.zoom">ZOOM: {{ Math.round(zoom * 100) }}%</div>
			<button :class="$style.menuButton" class="_button" @click="showMenu"><i class="ti ti-dots"></i></button>
		</div>
		<div ref="containerContainer" :class="[$style.containerContainer, { [$style.animatedBg]: preferences.r.animatedBgInPreview.value }]" @wheel="onViewWheel" @click="onViewClick" @pointermove="onPointermove">
			<div :class="$style.canvasFrame" :style="{ scale: zoom }">
				<div ref="canvasContainer" :class="$style.canvasContainer"></div>
				<div v-if="showGridInPreview" :class="$style.grid">
					<div v-for="position in gridLinePositions" :key="`vertical-${position}`" :class="[$style.gridLine, $style.gridLineVertical]" :style="{ left: `${position * 100}%` }"></div>
					<div v-for="position in gridLinePositions" :key="`horizontal-${position}`" :class="[$style.gridLine, $style.gridLineHorizontal]" :style="{ top: `${position * 100}%` }"></div>
				</div>
			</div>
		</div>
	</div>
</GsDetachableView>
</template>

<script lang="ts" setup>
import { watch, useTemplateRef, ref, computed, onBeforeUnmount } from 'vue';
import { genId } from '@gs/shared/utility/id.ts';
import { useRendererCanvas } from '@/use-renderer-canvas.ts';
import GsDetachableView from './GsDetachableView.vue';
import * as api from '@/api.ts';
import { appStateManager, activePreviewRenderer, visualModuleRendererManagerController, previewPlayback, highlightClipping, resolutionFactor, liveTimeFactor } from '@/app.ts';
import { preferences } from '@/preferences.ts';
import * as ui from '@/ui.ts';

const canvasContainer = useTemplateRef('canvasContainer');
const containerContainer = useTemplateRef('containerContainer');
const ZOOM_STEP = 1.25;
const gridLinePositions = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4];
const zoom = ref(1 / ZOOM_STEP / ZOOM_STEP / ZOOM_STEP);
const liveTime = ref(0);
const time = computed(() => previewPlayback.state.value.mode === 'timeline' ? previewPlayback.currentTimelineTime.value : liveTime.value);

let latestTime: number | null = null;

let timecodeRaf = window.requestAnimationFrame(function update(t) {
	const delta = latestTime == null ? 0 : t - latestTime;
	latestTime = t;
	if (previewPlayback.state.value.mode === 'live') liveTime.value += delta * liveTimeFactor.value;
	timecodeRaf = window.requestAnimationFrame(update);
});

watch(resolutionFactor, (newFactor, oldFactor) => {
	zoom.value *= (oldFactor ?? 1) / newFactor;
}, { immediate: true });

useRendererCanvas(canvasContainer, activePreviewRenderer, () => 'canvas');
onBeforeUnmount(() => window.cancelAnimationFrame(timecodeRaf));

async function onViewClick() {

}

async function onDrop(event: DragEvent) {
	const file = event.dataTransfer?.files[0];
	if (file == null) return;
	await addMedia(file);
}

async function addMedia(file?: File) {
	const visualModuleId = previewPlayback.liveVisualModuleId.value;
	if (visualModuleId == null) return;
	const result = await api.openMediaFile({ file });
	if (result == null) return;

	const assetId = genId();
	appStateManager.commit('addAsset', {
		id: assetId,
		name: result.name,
		width: result.width,
		height: result.height,
		fileDataType: result.type,
		fileData: result.fileData,
		hash: result.hash,
	});

	if (result.type.startsWith('image/')) {
		appStateManager.commit('addEffectNode', {
			visualModuleId,
			effectId: 'image',
			id: genId(),
			params: {
				image: { inputSource: 'literal', value: assetId },
			},
		});
	} else if (result.type.startsWith('video/') || result.type.startsWith('audio/')) {
		const playerId = genId();

		appStateManager.commit('addPlayer', {
			id: playerId,
			name: result.name,
			sourceType: 'asset',
			assetId: assetId,
		});

		appStateManager.commit('addEffectNode', {
			visualModuleId,
			effectId: result.type.startsWith('audio/') ? 'audioWaveform' : 'video',
			id: genId(),
			params: {
				player: { inputSource: 'literal', value: playerId },
			},
		});
	}
}

function onPointermove(ev: PointerEvent) {
	if (canvasContainer.value == null || previewPlayback.state.value.mode !== 'live') return;
	const rect = canvasContainer.value.getBoundingClientRect();
	visualModuleRendererManagerController.updatePointerPosition({
		x: (((ev.clientX - rect.left) / rect.width) - 0.5) * 2,
		y: -(((ev.clientY - rect.top) / rect.height) - 0.5) * 2,
	});
}

function onViewWheel(ev: WheelEvent) {
	ev.preventDefault();
	if (ev.deltaY < 0) {
		zoom.value = Math.max(0, Math.min(100, zoom.value * ZOOM_STEP));
	} else {
		zoom.value = Math.max(0, Math.min(100, zoom.value / ZOOM_STEP));
	}
}

function formatTime(timeMs: number): string {
	const ms = Math.floor(timeMs);
	const hours = String(Math.floor(ms / 3600000)).padStart(2, '0');
	const minutes = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
	const seconds = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
	const milliseconds = String(ms % 1000).padStart(3, '0');
	return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

const animatedBgInPreview = preferences.model('animatedBgInPreview');
const showTimecodeInPreview = preferences.model('showTimecodeInPreview');
const showGridInPreview = preferences.model('showGridInPreview');

function showMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: 'Highlight Clipping',
		icon: 'ti ti-alert-triangle',
		type: 'switch',
		ref: highlightClipping,
	}, {
		text: 'Animated Background',
		icon: 'ti ti-background',
		type: 'switch',
		ref: animatedBgInPreview,
	}, {
		text: 'Show Timecode',
		icon: 'ti ti-clock',
		type: 'switch',
		ref: showTimecodeInPreview,
	}, {
		text: 'Show Grid',
		icon: 'ti ti-grid-3x3',
		type: 'switch',
		ref: showGridInPreview,
	}], ev.currentTarget ?? ev.target);
}
</script>

<style module lang="scss">
.root {
	width: 100%;
	height: 100%;
}

.containerContainer {
	width: 100%;
	height: 100%;
	display: grid;
	place-content: center;
	overflow: clip;
	contain: content;
	background: #080808;

	&.animatedBg {
		$color1: #1a1a1a;
		$color2: #101010;
		background-color: $color1;
		background-image: linear-gradient(45deg, $color2 25%, transparent 25%, transparent 75%, $color2 75%, $color2), linear-gradient(-45deg, $color2 25%, transparent 25%, transparent 75%, $color2 75%, $color2);
		background-size: 32px 32px;
		animation: bg 0.7s linear infinite;
	}
}

.canvasFrame {
	position: relative;
}

.canvasContainer,
.canvasContainer > canvas {
	display: block;
}

.grid {
	position: absolute;
	inset: 0;
	pointer-events: none;
}

.gridLine {
	position: absolute;
	background: #ffffff80;
	box-shadow: 0 0 1px #000c;
}

.gridLineVertical {
	top: 0;
	bottom: 0;
	width: 1px;
	translate: -50% 0;
}

.gridLineHorizontal {
	left: 0;
	right: 0;
	height: 1px;
	translate: 0 -50%;
}

.topLeft {
	position: absolute;
	top: 0;
	left: 0;
	z-index: 1;
	background: #0008;
}

.topRight {
	position: absolute;
	top: 0;
	right: 0;
	z-index: 1;
	display: flex;
	background: #0008;
}

.time {
	display: flex;
	gap: 12px;
	padding: 4px 8px;
	color: var(--THEME-accent);
	font-variant-numeric: tabular-nums;
}

.zoom {
	padding: 4px 8px;
}

.menuButton {
	font-size: 90%;
}

@keyframes bg {
	0% {
		background-position: 0 0;
	}

	100% {
		background-position: -32px -32px;
	}
}
</style>
