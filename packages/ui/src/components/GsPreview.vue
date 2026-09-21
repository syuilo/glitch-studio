<template>
<GsDetachableView title="Preview">
	<template #default="{ detached }">
		<div :class="$style.root" @dragover.prevent.stop @drop.prevent.stop="onDrop">
			<div :class="$style.topLeft">
				<div v-if="showTimecodeInPreview" :class="$style.time" class="_monospace">{{ formatTime(time) }}</div>
			</div>
			<div :class="$style.topRight">
				<div :class="$style.zoom">ZOOM: {{ Math.round(zoom * 100) }}%</div>
				<button :class="$style.menuButton" class="_button" @click="showMenu"><i class="ti ti-dots"></i></button>
			</div>
			<div ref="containerContainer" :class="[$style.containerContainer, { [$style.animatedBg]: preferences.r.animatedBgInPreview.value }]" @wheel="onViewWheel" @click="onViewClick(detached)" @pointermove="onPointermove">
				<div ref="canvasContainer" :class="$style.canvasContainer" :style="{ scale: zoom }"></div>
			</div>
		</div>
	</template>
</GsDetachableView>
</template>

<script lang="ts" setup>
import { watch, useTemplateRef, ref, onBeforeUnmount, onMounted } from 'vue';
import { genId } from '@glitch/shared/utility/id.ts';
import GsDetachableView from './GsDetachableView.vue';
import * as api from '@/api.ts';
import { appContext, engine, highlightClipping, rendererEnv, resolutionFactor, liveTimeFactor } from '@/app.ts';
import { preferences } from '@/preferences.ts';
import * as ui from '@/ui.ts';

const canvasContainer = useTemplateRef('canvasContainer');
const containerContainer = useTemplateRef('containerContainer');
const ZOOM_STEP = 1.25;
const zoom = ref(1 / ZOOM_STEP / ZOOM_STEP / ZOOM_STEP);
const time = ref(0);

let latestTime = 0;

window.requestAnimationFrame(function update(t) {
	const delta = t - latestTime;
	latestTime = t;
	time.value += delta * liveTimeFactor.value;
	window.requestAnimationFrame(update);
});

watch(resolutionFactor, (newFactor, oldFactor) => {
	zoom.value *= (oldFactor ?? 1) / newFactor;
}, { immediate: true });

onMounted(() => {
	if (canvasContainer.value != null) {
		canvasContainer.value.appendChild(engine.canvas);
	}
});

onBeforeUnmount(() => {
	if (canvasContainer.value != null && engine.canvas.parentNode === canvasContainer.value) {
		canvasContainer.value.removeChild(engine.canvas);
	}
});

async function onViewClick(detached: boolean) {
	if (detached) return;
	//if (appContext.state.nodes.value.length === 0) {
	//	await addMedia();
	//}
}

async function onDrop(event: DragEvent) {
	const file = event.dataTransfer?.files[0];
	if (file == null) return;
	await addMedia(file);
}

async function addMedia(file?: File) {
	const result = await api.openMediaFile({ file });
	if (result == null) return;

	const assetId = genId();
	appContext.commit('addAsset', {
		id: assetId,
		name: result.name,
		width: result.width,
		height: result.height,
		data: result.data,
		fileDataType: result.type,
		fileData: result.fileData,
		hash: result.hash,
	});

	if (result.type.startsWith('image/')) {
		appContext.commit('addEffectNode', {
			effectId: 'image',
			id: genId(),
			params: {
				image: { inputSource: 'literal', value: assetId },
			},
		});
	} else if (result.type.startsWith('video/') || result.type.startsWith('audio/')) {
		const playerId = genId();

		appContext.commit('addPlayer', {
			id: playerId,
			name: result.name,
			sourceType: 'asset',
			assetId: assetId,
		});

		appContext.commit('addEffectNode', {
			effectId: result.type.startsWith('audio/') ? 'audioWaveform' : 'video',
			id: genId(),
			params: {
				player: { inputSource: 'literal', value: playerId },
			},
		});
	}
}

function onPointermove(ev: PointerEvent) {
	if (canvasContainer.value == null) return;
	const rect = canvasContainer.value.getBoundingClientRect();
	engine.updatePointerPosition({
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

.canvasContainer {
	display: block;
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
