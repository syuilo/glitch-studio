<template>
<GsDetachableView title="Preview" @changeWindow="onPreviewWindowChanged">
	<div :class="$style.root" @dragover.prevent.stop @drop.prevent.stop="onDrop">
		<div :class="$style.topLeft">
			<div v-if="showTimecodeInPreview" :class="$style.time" class="_monospace">
				<div>{{ formatTime(time) }}</div>
				<div v-if="currentFrameNumber != null">{{ currentFrameNumber }}</div>
			</div>
		</div>
		<div :class="$style.topCenter">
			<button v-if="previewTargetName" type="button" :class="$style.previewTargetName" class="_button" aria-haspopup="menu" @click="showPreviewTargetMenu">{{ previewTargetName }} <i class="ti ti-chevron-down"></i></button>
		</div>
		<div :class="$style.topRight">
			<div :class="$style.zoom">ZOOM: {{ Math.round(zoom * 100) }}%</div>
			<button :class="$style.menuButton" class="_button" @click="showMenu"><i class="ti ti-dots"></i></button>
		</div>
		<div ref="containerContainer" :class="[$style.containerContainer, { [$style.panning]: panning }]" @wheel="onViewWheel" @click="onViewClick" @pointermove="onPointermove" @pointerdown="onViewPointerdown" @auxclick.prevent>
			<div ref="canvasContainer" :class="[$style.canvasContainer, { [$style.animatedBg]: preferences.r.animatedBgInPreview.value }]" :style="{ scale: zoom, translate: `${pan[0]}px ${pan[1]}px` }"></div>
			<div v-if="showGridInPreview" ref="gridOverlay" :class="$style.grid">
				<div v-for="(line, index) in gridLines" :key="index" :class="$style.gridLine" :style="line"></div>
			</div>
			<GsPreviewTransform :canvasRect="previewCanvasRect"/>
		</div>
	</div>
</GsDetachableView>
</template>

<script lang="ts" setup>
import { watch, useTemplateRef, ref, shallowRef, computed, onBeforeUnmount } from 'vue';
import { genId } from '@gs/shared/utility/id.ts';
import GsDetachableView from './GsDetachableView.vue';
import GsPreviewTransform from './GsPreviewTransform.vue';
import type { CSSProperties } from 'vue';
import type { PreviewCanvasRect } from '@/utility/preview-transform.ts';
import { startPreviewPointerDrag } from '@/utility/preview-pointer-drag.ts';
import { useRendererCanvas } from '@/use-renderer-canvas.ts';
import { appContext } from '@/app.ts';
import * as api from '@/api.ts';
import { preferences } from '@/preferences.ts';
import * as ui from '@/ui.ts';

const { activePreviewRenderer, visualModuleRendererManagerController, previewPlayback, highlightClipping, resolutionFactor, liveTimeFactor, activeScene, activeSceneId } = appContext;
const { stateManager } = appContext.projectContext;

const canvasContainer = useTemplateRef('canvasContainer');
const containerContainer = useTemplateRef('containerContainer');
const gridOverlay = useTemplateRef('gridOverlay');
const gridLines = shallowRef<CSSProperties[]>([]);
const ZOOM_STEP = 1.25;
const gridLinePositions = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4];
const zoom = ref(1 / ZOOM_STEP / ZOOM_STEP / ZOOM_STEP);
const pan = ref<[number, number]>([0, 0]);
const panning = ref(false);
const previewCanvasRect = shallowRef<PreviewCanvasRect>({ left: 0, top: 0, width: 0, height: 0 });
let stopPan: (() => void) | undefined;
const liveTime = ref(0);
const time = computed(() => previewPlayback.state.value.mode === 'timeline' ? previewPlayback.currentTimelineTime.value : liveTime.value);
const currentFrameNumber = computed(() => {
	if (previewPlayback.state.value.mode !== 'timeline') return null;
	// プレビューの描画頻度を下げても、フレーム番号はタイムラインの設定FPSを基準にする。
	// フレーム送りで生じる浮動小数点誤差により、境界が直前のフレームに切り捨てられるのを防ぐ。
	return Math.floor(time.value * stateManager.state.timelineFps.value / 1000 + 1e-7);
});
const previewTargetName = computed(() => {
	const state = previewPlayback.state.value;
	return state.mode === 'timeline'
		? activeScene.value?.name ?? null
		: stateManager.state.visualModules.value.find(visualModule => visualModule.id === state.visualModuleId)?.name ?? null;
});

let latestTime: number | null = null;
let latestGridGeometry = '';

let animationWindow = window;
let timecodeRaf = animationWindow.requestAnimationFrame(update);

function update(t: number) {
	const delta = latestTime == null ? 0 : t - latestTime;
	latestTime = t;
	if (previewPlayback.state.value.mode === 'live') liveTime.value += delta * liveTimeFactor.value;
	updateGridLines();
	updatePreviewCanvasRect();
	timecodeRaf = animationWindow.requestAnimationFrame(update);
}

watch(resolutionFactor, (newFactor, oldFactor) => {
	zoom.value *= (oldFactor ?? 1) / newFactor;
}, { immediate: true });

useRendererCanvas(canvasContainer, activePreviewRenderer, () => 'canvas');
onBeforeUnmount(() => { animationWindow.cancelAnimationFrame(timecodeRaf); cancelPan(); });

function onPreviewWindowChanged() {
	cancelPan();
	// 元のウィンドウが非表示でも、切り離したプレビューの寸法・DPRを更新し続ける。
	animationWindow.cancelAnimationFrame(timecodeRaf);
	animationWindow = canvasContainer.value?.ownerDocument.defaultView ?? window;
	latestTime = null;
	timecodeRaf = animationWindow.requestAnimationFrame(update);
}

function updatePreviewCanvasRect() {
	if (!canvasContainer.value || !containerContainer.value) return;
	const canvas = canvasContainer.value.getBoundingClientRect();
	const container = containerContainer.value.getBoundingClientRect();
	const next = { left: canvas.left - container.left, top: canvas.top - container.top, width: canvas.width, height: canvas.height };
	const previous = previewCanvasRect.value;
	if (next.left !== previous.left || next.top !== previous.top || next.width !== previous.width || next.height !== previous.height) previewCanvasRect.value = next;
}

function cancelPan() { stopPan?.(); }

function onViewPointerdown(event: PointerEvent) {
	if (event.button !== 1 || stopPan) return;
	const initial = [...pan.value];
	panning.value = true;
	stopPan = startPreviewPointerDrag(event, {
		move: next => { pan.value = [initial[0] + next.clientX - event.clientX, initial[1] + next.clientY - event.clientY]; },
		end: cancelled => { if (cancelled) pan.value = [initial[0], initial[1]]; panning.value = false; stopPan = undefined; },
	});
}

function updateGridLines() {
	const overlay = gridOverlay.value;
	const canvas = canvasContainer.value;
	if (overlay == null || canvas == null) return;

	// 既存の表示更新に合わせて実寸を読むことで、パネル移動・Canvas交換・別画面のDPR変更にも追従する。
	const canvasRect = canvas.getBoundingClientRect();
	const overlayRect = overlay.getBoundingClientRect();
	const pixelRatio = overlay.ownerDocument.defaultView?.devicePixelRatio ?? 1;
	const geometry = [canvasRect.left, canvasRect.top, canvasRect.width, canvasRect.height, overlayRect.left, overlayRect.top, pixelRatio].join(',');
	if (geometry === latestGridGeometry) return;
	latestGridGeometry = geometry;
	if (canvasRect.width <= 0 || canvasRect.height <= 0) {
		gridLines.value = [];
		return;
	}

	// 線はscaleの外に置き、両端を物理ピクセル境界に揃える。
	// コンテナの原点も小数になり得るため、画面座標で丸めてからローカル座標へ戻す。
	const snap = (value: number) => Math.round(value * pixelRatio) / pixelRatio;
	const lineWidth = Math.max(1, Math.round(pixelRatio)) / pixelRatio;
	const left = snap(canvasRect.left) - overlayRect.left;
	const top = snap(canvasRect.top) - overlayRect.top;
	const width = snap(canvasRect.right) - snap(canvasRect.left);
	const height = snap(canvasRect.bottom) - snap(canvasRect.top);
	gridLines.value = gridLinePositions.flatMap(position => [{
		left: `${snap(canvasRect.left + canvasRect.width * position - lineWidth / 2) - overlayRect.left}px`,
		top: `${top}px`,
		width: `${lineWidth}px`,
		height: `${height}px`,
	}, {
		left: `${left}px`,
		top: `${snap(canvasRect.top + canvasRect.height * position - lineWidth / 2) - overlayRect.top}px`,
		width: `${width}px`,
		height: `${lineWidth}px`,
	}]);
}

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
	stateManager.commit('addAsset', {
		id: assetId,
		name: result.name,
		width: result.width,
		height: result.height,
		fileDataType: result.type,
		fileData: result.fileData,
		sourceFilePath: result.sourceFilePath,
		hash: result.hash,
	});

	if (result.type.startsWith('image/')) {
		stateManager.commit('addEffectNode', {
			visualModuleId,
			effectId: 'image',
			id: genId(),
			params: {
				image: { inputSource: 'literal', value: assetId },
			},
		});
	} else if (result.type.startsWith('video/') || result.type.startsWith('audio/')) {
		const playerId = genId();

		stateManager.commit('addPlayer', {
			id: playerId,
			name: result.name,
			sourceType: 'asset',
			assetId: assetId,
		});

		stateManager.commit('addEffectNode', {
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
	if (panning.value || ev.deltaY === 0) return;
	const nextZoom = Math.max(0, Math.min(100, ev.deltaY < 0 ? zoom.value * ZOOM_STEP : zoom.value / ZOOM_STEP));
	if (nextZoom === zoom.value) return;
	const canvasRect = canvasContainer.value?.getBoundingClientRect();
	if (canvasRect && zoom.value > 0) {
		// CSSのscaleはCanvas中央を支点にするため、ポインターまでの距離の変化を
		// panで相殺する。パン済みの表示位置と上限適用後の倍率を使い、直下の点を保つ。
		const scaleChange = nextZoom / zoom.value;
		pan.value = [
			pan.value[0] + (ev.clientX - canvasRect.left - canvasRect.width / 2) * (1 - scaleChange),
			pan.value[1] + (ev.clientY - canvasRect.top - canvasRect.height / 2) * (1 - scaleChange),
		];
	}
	zoom.value = nextZoom;
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
const showTransformInPreview = preferences.model('showTransformInPreview');

function showPreviewTargetMenu(ev: PointerEvent) {
	ui.popupMenu([{
		type: 'parent',
		text: 'Scene',
		icon: 'ti ti-memory',
		children: () => stateManager.state.timelineScenes.value.map(scene => ({
			text: scene.name,
			active: previewPlayback.state.value.mode === 'timeline' && activeSceneId.value === scene.id,
			action: () => {
				activeSceneId.value = scene.id;
				previewPlayback.showTimeline();
			},
		})),
	}, {
		type: 'parent',
		text: 'Visual Module',
		icon: 'ti ti-box-multiple',
		children: () => stateManager.state.visualModules.value.map(visualModule => ({
			text: visualModule.name,
			active: previewPlayback.liveVisualModuleId.value === visualModule.id,
			action: () => {
				// 同じLIVE対象の再選択では、Preview Paramsで設定した値を初期化しない。
				if (previewPlayback.liveVisualModuleId.value !== visualModule.id) previewPlayback.startLive(visualModule.id);
			},
		})),
	}], ev.currentTarget ?? ev.target);
}

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
	}, {
		text: 'Show Layer Transform',
		icon: 'ti ti-transform',
		type: 'switch',
		ref: showTransformInPreview,
	}, {
		text: 'Center View',
		icon: 'ti ti-focus-centered',
		action: () => { pan.value = [0, 0]; },
	}], ev.currentTarget ?? ev.target);
}
</script>

<style module lang="scss">
.root {
	width: 100%;
	height: 100%;
}

.containerContainer {
	position: relative;
	width: 100%;
	height: 100%;
	display: grid;
	place-content: center;
	overflow: clip;
	contain: content;
	background: #080808;
}

.canvasContainer {
	background: #000;

	&.animatedBg {
		$color1: #1a1a1a;
		$color2: #101010;
		background-color: $color1;
		background-image: linear-gradient(45deg, $color2 25%, transparent 25%, transparent 75%, $color2 75%, $color2), linear-gradient(-45deg, $color2 25%, transparent 25%, transparent 75%, $color2 75%, $color2);
		background-size: 64px 64px;
		animation: bg 0.7s linear infinite;
	}
}

.canvasContainer,
.canvasContainer > canvas {
	display: block;
}

//.panning, .panning * {
//	cursor: grabbing !important;
//}

.grid {
	position: absolute;
	inset: 0;
	pointer-events: none;
}

.gridLine {
	position: absolute;
	background: #ffffff80;
}

.topLeft {
	position: absolute;
	top: 0;
	left: 0;
	z-index: 1;
	background: #0008;
}

.topCenter {
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	margin: 0 auto;
	z-index: 1;
	display: flex;
	width: 300px;
	align-items: center;
	justify-content: center;
}

.previewTargetName {
	padding: 4px 8px;
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
	padding: 4px 8px;
	color: var(--THEME-accent);
	font-variant-numeric: tabular-nums;
	text-align: right;
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
		background-position: -64px -64px;
	}
}
</style>
