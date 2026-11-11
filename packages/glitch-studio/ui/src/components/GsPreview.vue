<template>
<GsDetachableView :title="i18n.ts.Preview" :suspended="renderEngine.isSuspended.value" @changeWindow="onPreviewWindowChanged">
	<div :class="[$style.root, { [$style.withRulers]: showRulersInPreview }]">
		<div :class="$style.header">
			<div :class="$style.left">
				<div v-if="showTimecodeInPreview" :class="$style.time" class="_monospace">
					<span>T: {{ formatTime(time) }}<span v-if="currentFrameNumber != null"> F: {{ currentFrameNumber }}</span></span>
				</div>
			</div>
			<div :class="$style.center">
				<button v-if="previewTargetName" :class="$style.previewTargetName" class="_button" @click="showPreviewTargetMenu">
					<i v-if="previewPlayback.state.value.mode === 'timeline'" class="ti ti-memory"></i><i v-else-if="previewPlayback.state.value.mode === 'visualModuleLivePreview'" class="ti ti-chart-dots-3"></i> {{ previewTargetName }} <i class="ti ti-chevron-down"></i>
				</button>
			</div>
			<div :class="$style.right">
				<div :class="$style.zoom" data-test-preview-zoom>{{ i18n.ts._Preview.Zoom }}: {{ Math.round(zoom * 100) }}%</div>
				<button :class="$style.iconButton" class="_button" data-test-preview-zoom-to-100 @click="zoomTo100"><i class="ti ti-number-100-small"></i></button>
				<button :class="$style.iconButton" class="_button" data-test-preview-fit-zoom @click="fitZoom"><i class="ti ti-maximize"></i></button>
				<div :class="$style.divider"></div>
				<button v-tooltip="i18n.ts._Preview.ShowGrid" :class="[$style.iconButton, showGridInPreview ? '_buttonPrimaryFg' : '_button']" @click="toggleGrid"><i class="ti ti-grid-3x3"></i></button>
				<button
					v-tooltip="i18n.ts._Preview.HighlightSettings"
					:class="[$style.iconButton, highlightClipping || previewGamutWarning.enabled ? '_buttonPrimaryFg' : '_button']"
					data-test-preview-highlight-menu
					@click="showHighlightMenu"
				>
					<i class="ti ti-eye-exclamation"></i>
				</button>
				<div :class="$style.divider"></div>
				<button :class="$style.iconButton" class="_button" data-test-preview-menu @click="showMenu"><i class="ti ti-dots"></i></button>
			</div>
		</div>

		<div :class="$style.previewArea">
			<div ref="containerContainer" :class="[$style.containerContainer, { [$style.panning]: panning }]" data-test-preview-viewport @wheel="onViewWheel" @click="onViewClick" @pointermove="onPointermove" @pointerdown="onViewPointerdown" @auxclick.prevent>
				<div v-show="!renderEngine.isSuspended.value" ref="canvasContainer" :style="{ scale: zoom / previewDevicePixelRatio, translate: `${pan[0]}px ${pan[1]}px` }" data-test-preview-canvas-container></div>
				<div v-if="showGridInPreview && !renderEngine.isSuspended.value" ref="gridOverlay" :class="$style.grid">
					<div v-for="(line, index) in gridLines" :key="index" :class="$style.gridLine" :style="line"></div>
				</div>
				<GsPreviewTransform v-if="appContext.previewParameterEditing.handles.value.length === 0" :canvasRect="previewCanvasRect"/>
				<GsPreviewParameterPositions :canvasRect="previewCanvasRect" :showGrid="showGridInPreview"/>
				<div v-if="previewPlayback.state.value.mode === 'timeline' && !previewPlayback.isTimelinePlaying.value && timelineRendererManagerController.isSeeking.value" :class="$style.seekLoading" data-test-timeline-seek-loading>
					<GsLoading :colored="false" :mini="true"/>
				</div>
			</div>
			<GsPreviewRulers v-if="showRulersInPreview && !renderEngine.isSuspended.value" :canvasRect="previewCanvasRect" :viewportSize="previewViewportSize"/>
		</div>

		<div :class="$style.footer">
			<div :class="$style.left">
				<div :class="$style.resolution" class="_monospace">
					<div>{{ previewResolution?.width ?? '-' }} x {{ previewResolution?.height ?? '-' }} px</div>
				</div>
			</div>
			<div :class="$style.right">
				<GsPreviewColorView/>
				<button v-tooltip="i18n.ts._Preview.Exposure" :class="[$style.exposure, previewExposure !== 0 ? '_buttonPrimaryFg' : '_button']" class="_monospace" data-test-preview-exposure :data-test-preview-exposure-active="previewExposure !== 0" @pointerdown="onExposurePointerdown" @click="onExposureClick" @keydown="onExposureKeydown"><i class="ti ti-exposure"></i><span style="white-space: pre-wrap;">{{ previewExposure > 0 ? '+' : previewExposure < 0 ? '' : ' ' }}{{ previewExposure.toFixed(1) }} EV</span></button>
			</div>
		</div>

		<div v-if="renderEngine.errorMessage.value" :class="$style.renderError" class="_gaps_s _selectable">
			<div v-if="renderFailureLocation">{{ renderFailureLocation }}</div>
			<div>{{ renderEngine.errorMessage.value }}</div>
			<button class="_button" :disabled="renderValidationErrorMessage != null" @click="renderEngine.retry()">{{ i18n.ts._Preview.Retry }}</button>
		</div>
	</div>
</GsDetachableView>
</template>

<script lang="ts" setup>
import { watch, useTemplateRef, ref, shallowRef, computed, onBeforeUnmount } from 'vue';
import { scaleResolution } from '@gs/shared/resolution.js';
import { getSceneBaseResolution } from '@gs/subsystems_timeline_shared/scene-resolution.js';
import { PREVIEW_GAMUT_WARNING_BOUNDS, PREVIEW_GAMUT_WARNING_REFERENCE_GAMUTS } from '@gs/glitch-studio_shared/preview-gamut-warning.ts';
import type { PreviewGamutWarningReferenceGamut } from '@gs/glitch-studio_shared/preview-gamut-warning.ts';
import { PREVIEW_WARNING_IMAGE_SOURCES } from '@gs/glitch-studio_shared/preview-warning-image-source.ts';
import type { PreviewWarningImageSource } from '@gs/glitch-studio_shared/preview-warning-image-source.ts';
import type { RgbGamutBounds } from '@gs/shared/rgb-gamut.ts';
import GsDetachableView from './GsDetachableView.vue';
import GsPreviewTransform from './GsPreviewTransform.vue';
import GsPreviewParameterPositions from './GsPreviewParameterPositions.vue';
import GsPreviewRulers from './GsPreviewRulers.vue';
import GsPreviewColorView from './GsPreviewColorView.vue';
import GsLoading from './common/GsLoading.vue';
import type { CSSProperties } from 'vue';
import type { PreviewCanvasRect } from '@/utility/preview-transform.ts';
import type { PreviewViewportSize } from '@/utility/preview-rulers.ts';
import { i18n } from '@/i18n.ts';
import { startPreviewPointerDrag } from '@/utility/preview-pointer-drag.ts';
import { previewGridLinePositions } from '@/utility/preview-parameter-position.ts';
import { useRendererCanvas } from '@/use-renderer-canvas.ts';
import { formatRenderFailureOrigin } from '@/utility/render-failure.ts';
import { appContext } from '@/app.ts';
import { preferences } from '@/preferences.ts';
import * as ui from '@/ui.ts';

const { activePreviewRenderer, visualModuleRendererManagerController, timelineRendererManagerController, previewPlayback, highlightClipping, previewWarningImageSource, previewGamutWarning, previewExposure, resolutionFactor, visualModuleLivePreviewTimeFactor, activeScene, activeSceneId, renderEngine, renderValidation } = appContext;
const previewWarningImageSourceLabels = computed<Record<PreviewWarningImageSource, string>>(() => ({
	original: i18n.ts._Preview.WarningImageSourceOriginal,
	previewAdjusted: i18n.ts._Preview.WarningImageSourceAdjusted,
}));
const previewGamutWarningEnabled = computed({
	get: () => previewGamutWarning.value.enabled,
	set: enabled => { previewGamutWarning.value = { ...previewGamutWarning.value, enabled }; },
});
const previewGamutWarningReferenceLabels = computed<Record<PreviewGamutWarningReferenceGamut, string>>(() => ({
	srgb: 'sRGB', displayP3: 'Display P3', rec2020: 'Rec.2020', adobeRgb: 'Adobe RGB',
	acescg: i18n.ts._Preview.GamutWarningAcescg,
}));
const previewGamutWarningBoundsLabels = computed<Record<RgbGamutBounds, string>>(() => ({
	nonNegative: i18n.ts._Preview.GamutWarningBoundsPrimaries,
	unit: i18n.ts._Preview.GamutWarningBoundsUnit,
}));
const { stateManager } = appContext.projectContext;
const renderValidationErrorMessage = renderValidation.errorMessage;
const renderFailureLocation = computed(() => {
	const origin = renderEngine.runtimeDiagnostic.value?.origin;
	return origin && renderValidation.errorMessage.value == null
		? formatRenderFailureOrigin(origin, stateManager.state.visualModules.value, stateManager.state.timelineScenes.value) : null;
});

const canvasContainer = useTemplateRef('canvasContainer');
const containerContainer = useTemplateRef('containerContainer');
const gridOverlay = useTemplateRef('gridOverlay');
const gridLines = shallowRef<CSSProperties[]>([]);
const ZOOM_STEP = 1.25;
const PREVIEW_EXPOSURE_LIMIT = 20;
const PREVIEW_EXPOSURE_PIXELS_PER_EV = 40;
// 100%は出力の1pxが画面の物理1pxに対応する倍率。CSSのscaleへ渡すときだけDPRで割る。
const zoom = ref(1);
const previewDevicePixelRatio = ref(window.devicePixelRatio);
let initialZoomPending = true;
const pan = ref<[number, number]>([0, 0]);
const panning = ref(false);
const previewCanvasRect = shallowRef<PreviewCanvasRect>({
	left: 0,
	top: 0,
	width: 0,
	height: 0,
});
const previewViewportSize = shallowRef<PreviewViewportSize>({ width: 0, height: 0 });
let stopPan: (() => void) | null = null;
let stopExposureDrag: (() => void) | null = null;
let suppressExposureClick = false;
let mainEditingDocument: Document | null = null;
let editingDocuments = new Set<Document>();

function onEditingKeydown(event: KeyboardEvent) {
	if (event.key !== 'Escape' || event.defaultPrevented || appContext.previewParameterEditing.handles.value.length === 0) return;
	appContext.previewParameterEditing.clear();
	event.preventDefault();
}

function updateEditingDocument() {
	for (const doc of editingDocuments) doc.removeEventListener('keydown', onEditingKeydown);
	const currentDocument = containerContainer.value?.ownerDocument ?? null;
	mainEditingDocument ??= currentDocument;
	// プレビューを切り離した場合も、数値欄のある元ウィンドウから解除できるようにする。
	editingDocuments = new Set([mainEditingDocument, currentDocument].filter((doc): doc is Document => doc != null));
	for (const doc of editingDocuments) doc.addEventListener('keydown', onEditingKeydown);
}

watch(containerContainer, updateEditingDocument);
onBeforeUnmount(() => { for (const doc of editingDocuments) doc.removeEventListener('keydown', onEditingKeydown); });
const visualModuleLivePreviewTime = ref(0);
const time = computed(() => previewPlayback.state.value.mode === 'timeline' ? previewPlayback.currentTimelineTime.value : visualModuleLivePreviewTime.value);
const currentFrameNumber = computed(() => {
	if (previewPlayback.state.value.mode !== 'timeline') return null;
	// シーク・コマ送り・キャッシュと同じプレビューの時計で番号を表示する。
	return Math.floor(time.value * stateManager.state.timelineFps.value * appContext.timelinePreviewFpsFactor.value / 1000 + 1e-7);
});
const previewTargetName = computed(() => {
	const state = previewPlayback.state.value;
	return state.mode === 'timeline'
		? activeScene.value?.name ?? null
		: stateManager.state.visualModules.value.find(visualModule => visualModule.id === state.visualModuleId)?.name ?? null;
});
const previewResolution = computed(() => {
	if (previewPlayback.state.value.mode === 'visualModuleLivePreview') return visualModuleRendererManagerController.outputResolution.value;
	const scene = activeScene.value;
	if (scene == null) return null;
	return scaleResolution(getSceneBaseResolution(scene.resolution, stateManager.state.resolution.value), resolutionFactor.value);
});

let latestTime: number | null = null;
let latestGridGeometry = '';

let animationWindow = window;
let timecodeRaf: number | null = null;

function update(t: number) {
	timecodeRaf = null;
	if (renderEngine.isSuspended.value) return;
	const delta = latestTime == null ? 0 : t - latestTime;
	latestTime = t;
	if (previewPlayback.state.value.mode === 'visualModuleLivePreview') visualModuleLivePreviewTime.value += delta * visualModuleLivePreviewTimeFactor.value;
	appContext.previewParameterEditing.time.value = visualModuleLivePreviewTime.value;
	updatePreviewDevicePixelRatio();
	fitInitialZoom();
	updateGridLines();
	updatePreviewCanvasRect();
	timecodeRaf = animationWindow.requestAnimationFrame(update);
}

watch(resolutionFactor, (newFactor, oldFactor) => {
	zoom.value *= (oldFactor ?? 1) / newFactor;
}, { immediate: true });

useRendererCanvas(canvasContainer, activePreviewRenderer, () => 'canvas', renderEngine.isSuspended);
watch(renderEngine.isSuspended, updateTimecodeLoop, { immediate: true });
onBeforeUnmount(() => { if (timecodeRaf != null) animationWindow.cancelAnimationFrame(timecodeRaf); cancelPan(); stopExposureDrag?.(); });

function updateTimecodeLoop() {
	if (timecodeRaf != null) animationWindow.cancelAnimationFrame(timecodeRaf);
	timecodeRaf = null;
	// 休止中の実時間をLive Previewの表示時刻へ加算しない。
	latestTime = null;
	updatePreviewDevicePixelRatio();
	if (!renderEngine.isSuspended.value) timecodeRaf = animationWindow.requestAnimationFrame(update);
}

function updatePreviewDevicePixelRatio() {
	// 別ウィンドウやDPRの異なる画面へ移しても、物理ピクセル基準の倍率を維持する。
	previewDevicePixelRatio.value = canvasContainer.value?.ownerDocument.defaultView?.devicePixelRatio ?? window.devicePixelRatio;
}

function fitInitialZoom() {
	if (!initialZoomPending) return;
	const resolution = previewResolution.value;
	const canvas = canvasContainer.value;
	// Workerの初期化前には仮のCanvas寸法が見えるため、実際の出力寸法が反映されるまで待つ。
	// 非表示パネルの表示領域が0の場合も、fitZoomが成功するまで次のフレームで再試行する。
	if (resolution == null || canvas == null || canvas.clientWidth !== resolution.width || canvas.clientHeight !== resolution.height) return;
	if (fitZoom()) initialZoomPending = false;
}

function onPreviewWindowChanged() {
	cancelPan();
	stopExposureDrag?.();
	updateEditingDocument();
	// 元のウィンドウが非表示でも、切り離したプレビューの寸法・DPRを更新し続ける。
	if (timecodeRaf != null) animationWindow.cancelAnimationFrame(timecodeRaf);
	animationWindow = canvasContainer.value?.ownerDocument.defaultView ?? window;
	updateTimecodeLoop();
}

function updatePreviewCanvasRect() {
	if (canvasContainer.value == null || containerContainer.value == null) return;
	const canvas = canvasContainer.value.getBoundingClientRect();
	const container = containerContainer.value.getBoundingClientRect();
	if (container.width !== previewViewportSize.value.width || container.height !== previewViewportSize.value.height) {
		previewViewportSize.value = { width: container.width, height: container.height };
	}
	const next = {
		left: canvas.left - container.left,
		top: canvas.top - container.top,
		width: canvas.width,
		height: canvas.height,
	};
	const previous = previewCanvasRect.value;
	if (next.left !== previous.left || next.top !== previous.top || next.width !== previous.width || next.height !== previous.height) previewCanvasRect.value = next;
}

function cancelPan() { stopPan?.(); }

function setPreviewExposure(value: number) {
	// 表示と実際の補正を0.1 EVに揃え、-0.0や無制限な指数の増大を避ける。
	const rounded = Math.round(Math.max(-PREVIEW_EXPOSURE_LIMIT, Math.min(PREVIEW_EXPOSURE_LIMIT, value)) * 10) / 10;
	previewExposure.value = rounded === 0 ? 0 : rounded;
}

function onExposurePointerdown(event: PointerEvent) {
	if (event.button !== 0 || stopExposureDrag != null) return;
	const initialExposure = previewExposure.value;
	let moved = false;
	suppressExposureClick = false;
	stopExposureDrag = startPreviewPointerDrag(event, {
		move: next => {
			// クリック時の小さな手ぶれは無視する。横へ外れた操作もドラッグ扱いにし、
			// 値を調整した直後のclickで意図せず0 EVへ戻ることを防ぐ。
			if (Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) >= 3) moved = true;
			if (moved) setPreviewExposure(initialExposure + (event.clientY - next.clientY) / PREVIEW_EXPOSURE_PIXELS_PER_EV);
		},
		end: cancelled => {
			if (cancelled) previewExposure.value = initialExposure;
			suppressExposureClick = moved || cancelled;
			stopExposureDrag = null;
		},
	});
}

function onExposureClick(event: MouseEvent) {
	// キーボードによるbuttonの操作は、前回のドラッグの有無に関係なくリセットする。
	if (!suppressExposureClick || event.detail === 0) previewExposure.value = 0;
	suppressExposureClick = false;
}

function onExposureKeydown(event: KeyboardEvent) {
	if (stopExposureDrag != null || !['ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
	event.preventDefault();
	setPreviewExposure(event.key === 'Home' ? 0 : previewExposure.value + (event.key === 'ArrowUp' ? 0.1 : -0.1));
}

function onViewPointerdown(event: PointerEvent) {
	if (event.button !== 1 || stopPan) return;
	const initial = [...pan.value];
	panning.value = true;
	stopPan = startPreviewPointerDrag(event, {
		move: next => { pan.value = [initial[0] + next.clientX - event.clientX, initial[1] + next.clientY - event.clientY]; },
		end: cancelled => { if (cancelled) pan.value = [initial[0], initial[1]]; panning.value = false; stopPan = null; },
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
	gridLines.value = previewGridLinePositions.flatMap(position => [{
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

function onPointermove(ev: PointerEvent) {
	if (canvasContainer.value == null || previewPlayback.state.value.mode !== 'visualModuleLivePreview') return;
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

function zoomTo100() {
	cancelPan();
	updatePreviewDevicePixelRatio();
	zoom.value = 1;
	pan.value = [0, 0];
}

function fitZoom() {
	const canvas = canvasContainer.value;
	const container = containerContainer.value;
	if (canvas == null || container == null) return false;
	const available = container.getBoundingClientRect();
	if (canvas.clientWidth <= 0 || canvas.clientHeight <= 0 || available.width <= 0 || available.height <= 0) return false;

	cancelPan();
	updatePreviewDevicePixelRatio();
	// Canvasの未変形の実寸と、ヘッダー・フッターを除いた表示領域を比較する。
	// CSS上で収まる最大倍率を物理ピクセル基準へ換算し、100%を超える拡大も許可する。
	zoom.value = Math.min(available.width / canvas.clientWidth, available.height / canvas.clientHeight) * previewDevicePixelRatio.value;
	pan.value = [0, 0];
	return true;
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
const showRulersInPreview = preferences.model('showRulersInPreview');
const showTransformInPreview = preferences.model('showTransformInPreview');

function showPreviewTargetMenu(ev: PointerEvent) {
	ui.popupMenu([{
		type: 'parent',
		text: i18n.ts.Scene,
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
		text: i18n.ts.VisualModule,
		icon: 'ti ti-box-multiple',
		children: () => stateManager.state.visualModules.value.map(visualModule => ({
			text: visualModule.name,
			active: previewPlayback.visualModuleLivePreviewVisualModuleId.value === visualModule.id,
			action: () => {
				// 同じVisual Module Live Preview対象の再選択では、Preview Paramsで設定した値を初期化しない。
				if (previewPlayback.visualModuleLivePreviewVisualModuleId.value !== visualModule.id) previewPlayback.startVisualModuleLivePreview(visualModule.id);
			},
		})),
	}], ev.currentTarget ?? ev.target);
}

function toggleGrid() {
	showGridInPreview.value = !showGridInPreview.value;
}

function showHighlightMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: i18n.ts._Preview.HighlightClipping,
		icon: 'ti ti-alert-triangle',
		type: 'switch',
		ref: highlightClipping,
	}, {
		id: 'preview-gamut-warning',
		text: i18n.ts._Preview.HighlightOutOfGamut,
		icon: 'ti ti-alert-triangle',
		type: 'switch',
		ref: previewGamutWarningEnabled,
	}, {
		text: computed(() => `${i18n.ts._Preview.WarningImageSource}: ${previewWarningImageSourceLabels.value[previewWarningImageSource.value]}`),
		type: 'parent',
		children: PREVIEW_WARNING_IMAGE_SOURCES.map(imageSource => ({
			id: `preview-warning-image-source-${imageSource}`,
			text: computed(() => previewWarningImageSourceLabels.value[imageSource]),
			caption: imageSource === 'original' ? i18n.ts._Preview.WarningImageSourceOriginalHint : i18n.ts._Preview.WarningImageSourceAdjustedHint,
			active: computed(() => previewWarningImageSource.value === imageSource),
			action: () => { previewWarningImageSource.value = imageSource; },
		})),
	}, {
		text: computed(() => `${i18n.ts._Preview.GamutWarningReference}: ${previewGamutWarningReferenceLabels.value[previewGamutWarning.value.referenceGamut]}`),
		type: 'parent',
		children: PREVIEW_GAMUT_WARNING_REFERENCE_GAMUTS.map(referenceGamut => ({
			id: `preview-gamut-warning-${referenceGamut}`,
			text: computed(() => previewGamutWarningReferenceLabels.value[referenceGamut]),
			caption: referenceGamut === 'acescg' ? i18n.ts._Preview.GamutWarningAcescgHint : null,
			active: computed(() => previewGamutWarning.value.referenceGamut === referenceGamut),
			action: () => { previewGamutWarning.value = { ...previewGamutWarning.value, referenceGamut }; },
		})),
	}, {
		text: computed(() => `${i18n.ts._Preview.GamutWarningBounds}: ${previewGamutWarningBoundsLabels.value[previewGamutWarning.value.bounds]}`),
		type: 'parent',
		children: PREVIEW_GAMUT_WARNING_BOUNDS.map(bounds => ({
			id: `preview-gamut-warning-bounds-${bounds}`,
			text: computed(() => previewGamutWarningBoundsLabels.value[bounds]),
			caption: bounds === 'nonNegative' ? i18n.ts._Preview.GamutWarningBoundsPrimariesHint : i18n.ts._Preview.GamutWarningBoundsUnitHint,
			active: computed(() => previewGamutWarning.value.bounds === bounds),
			action: () => { previewGamutWarning.value = { ...previewGamutWarning.value, bounds }; },
		})),
	}], ev.currentTarget ?? ev.target);
}

function showMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: i18n.ts._Preview.AnimatedBackground,
		icon: 'ti ti-background',
		type: 'switch',
		ref: animatedBgInPreview,
	}, {
		text: i18n.ts._Preview.ShowTimecode,
		icon: 'ti ti-clock',
		type: 'switch',
		ref: showTimecodeInPreview,
	}, {
		text: i18n.ts._Preview.ShowRulers,
		icon: 'ti ti-ruler',
		type: 'switch',
		ref: showRulersInPreview,
	}, {
		text: i18n.ts._Preview.ShowLayerTransform,
		icon: 'ti ti-transform',
		type: 'switch',
		ref: showTransformInPreview,
	}], ev.currentTarget ?? ev.target);
}
</script>

<style module lang="scss">
.root {
	--headerHeight: 25px;
	--footerHeight: 25px;
	--previewRulerSize: 0px;
	--previewOverlayBackground: #0008;

	position: relative;
	width: 100%;
	height: 100%;
	overflow: clip;
	contain: content;
	background: #080808;
}

.withRulers {
	--previewRulerSize: 24px;
}

.previewArea {
	position: absolute;
	inset: var(--headerHeight) 0 var(--footerHeight);
}

.containerContainer {
	position: absolute;
	inset: var(--previewRulerSize) 0 0 var(--previewRulerSize);
	// フィットの基準領域は保ち、拡大・パン時の画像は半透明のバーの背後にも表示する。
	// パネル外へのはみ出しはrootで切り取る。
	display: grid;
	place-content: center;
}

.seekLoading {
	position: absolute;
	top: 50%;
	left: 50%;
	translate: -50% -50%;
	border-radius: 50%;
	background: #0008;
	color: #fff;
	pointer-events: none;
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

.header {
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	z-index: 1;
	width: 100%;
	height: var(--headerHeight);
	line-height: var(--headerHeight);
	background: var(--previewOverlayBackground);
}

.footer {
	position: absolute;
	bottom: 0;
	left: 0;
	right: 0;
	z-index: 1;
	width: 100%;
	height: var(--footerHeight);
	line-height: var(--footerHeight);
	background: var(--previewOverlayBackground);
}

.exposure {
	height: 100%;
	min-width: 8em;
	padding: 0 12px;
	cursor: ns-resize;
	touch-action: none;
	user-select: none;
	font-variant-numeric: tabular-nums;
}

.left {
	position: absolute;
	top: 0;
	left: 0;
	height: 100%;

	display: flex;
	flex-direction: row;
	align-items: center;
	justify-content: center;
}

.center {
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	height: 100%;
	margin: 0 auto;

	display: flex;
	flex-direction: row;
	align-items: center;
	justify-content: center;
}

.right {
	position: absolute;
	top: 0;
	right: 0;
	height: 100%;

	display: flex;
	flex-direction: row;
	align-items: center;
	justify-content: center;
}

.divider {
	width: 1px;
	height: 100%;
	margin: 0 4px;
	background-color: #fff2;
}

.previewTargetName {
}

.time {
	padding: 0 8px;
	color: var(--THEME-accent);
	font-variant-numeric: tabular-nums;
	text-align: right;
}

.zoom {
	padding: 0 8px;
}

.iconButton {
	height: 100%;
	aspect-ratio: 1;
}

.resolution {
	padding: 0 8px;
	min-width: 0;
	white-space: nowrap;
	overflow: clip;
	text-overflow: ellipsis;
}

.renderError {
	position: absolute;
	top: 50%;
	left: 50%;
	translate: -50% -50%;
	padding: 8px;
	background: #000c;
	color: #fff;
	overflow-wrap: anywhere;
}

</style>
