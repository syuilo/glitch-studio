<template>
<div
	v-if="handle != null && canvasRect.width > 0 && canvasRect.height > 0"
	ref="surface"
	:class="[$style.surface, { [$style.dragging]: dragging }]"
	:style="{ left: `${canvasRect.left}px`, top: `${canvasRect.top}px`, width: `${canvasRect.width}px`, height: `${canvasRect.height}px` }"
	data-test-preview-viewport-editor
	@pointerdown="startDrag"
	@pointermove.stop
	@wheel="onWheel"
	@click.stop
>
	<div :class="$style.label"><i class="ti ti-arrows-move"></i> {{ handle.label() }}</div>
</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import { appContext } from '@/app.ts';
import { startPreviewPointerDrag } from '@/utility/preview-pointer-drag.ts';
import { previewScreenToParameter } from '@/utility/preview-parameter-position.ts';
import { panPreviewViewport, zoomPreviewViewport } from '@/utility/preview-viewport.ts';
import type { PreviewCanvasRect } from '@/utility/preview-transform.ts';
import type { PreviewViewportDrag, PreviewViewportValue } from '@/utility/preview-viewport.ts';

const props = defineProps<{ canvasRect: PreviewCanvasRect }>();
const handle = computed(() => appContext.previewParameterEditing.viewport.value);
const surface = useTemplateRef('surface');
const dragging = ref(false);
let stopDrag: (() => void) | null = null;
let wheelSession: PreviewViewportDrag | null = null;
let wheelValue: PreviewViewportValue | null = null;
let wheelFrame: number | null = null;
let wheelTimer: number | null = null;
let wheelDocument: Document | null = null;

function startDrag(event: PointerEvent) {
	if (event.button !== 0 || stopDrag != null || handle.value == null) return;
	finishWheel(false);
	const target = handle.value;
	const session = target.begin();
	if (session == null) return;
	event.stopPropagation();
	const longSide = Math.max(props.canvasRect.width, props.canvasRect.height);
	const view = surface.value!.ownerDocument.defaultView!;
	let latest = session.initialValue;
	let frame: number | null = null;
	const update = () => {
		frame = null;
		if (!session.active) { stopDrag?.(); return; }
		session.update(latest);
	};
	dragging.value = true;
	stopDrag = startPreviewPointerDrag(event, {
		move(next) {
			latest = panPreviewViewport(session.initialValue,
				[(next.clientX - event.clientX) / longSide, -(next.clientY - event.clientY) / longSide], target.spanAtZoomOne());
			frame ??= view.requestAnimationFrame(update);
		},
		end(cancelled) {
			if (frame != null) view.cancelAnimationFrame(frame);
			if (!cancelled && session.active) update();
			if (cancelled) session.cancel();
			else session.finish();
			stopDrag = null;
			dragging.value = false;
		},
	});
}

function updateWheel() {
	wheelFrame = null;
	if (wheelSession?.active !== true || wheelValue == null) { finishWheel(true); return; }
	wheelSession.update(wheelValue);
}

function finishWheel(cancelled: boolean) {
	if (wheelFrame != null) wheelDocument?.defaultView!.cancelAnimationFrame(wheelFrame);
	wheelFrame = null;
	if (wheelTimer != null) wheelDocument!.defaultView!.clearTimeout(wheelTimer);
	wheelTimer = null;
	if (!cancelled && wheelSession?.active === true && wheelValue != null) wheelSession.update(wheelValue);
	if (cancelled) wheelSession?.cancel();
	else wheelSession?.finish();
	wheelSession = null;
	wheelValue = null;
	wheelDocument?.removeEventListener('keydown', onWheelKeydown, true);
	wheelDocument?.defaultView!.removeEventListener('blur', cancelWheel);
	wheelDocument?.defaultView!.removeEventListener('pagehide', cancelWheel);
	wheelDocument = null;
}

function cancelWheel() { finishWheel(true); }

function onWheelKeydown(event: KeyboardEvent) {
	if (event.key !== 'Escape') return;
	event.preventDefault();
	event.stopImmediatePropagation();
	cancelWheel();
}

function onWheel(event: WheelEvent) {
	event.preventDefault();
	event.stopPropagation();
	if (stopDrag != null || handle.value == null || surface.value == null || event.deltaY === 0) return;
	if (wheelSession != null && !wheelSession.active) finishWheel(true);
	if (wheelSession == null) {
		wheelSession = handle.value.begin();
		if (wheelSession == null) return;
		wheelValue = wheelSession.initialValue;
		wheelDocument = surface.value.ownerDocument;
		wheelDocument.addEventListener('keydown', onWheelKeydown, true);
		wheelDocument.defaultView!.addEventListener('blur', cancelWheel);
		wheelDocument.defaultView!.addEventListener('pagehide', cancelWheel);
	}
	// deltaModeはpx・行・ページで異なる。トラックパッドの小さな差分も使い、
	// イベントの回数ではなくスクロール量に応じて倍率を連続的に変える。
	const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? props.canvasRect.height : 1);
	const factor = Math.exp(Math.max(-2, Math.min(2, -delta * 0.002)));
	const zoom = Math.min(handle.value.maximumZoom(), Math.max(handle.value.minimumZoom(), wheelValue!.zoom * factor));
	const bounds = surface.value.getBoundingClientRect();
	const point = previewScreenToParameter([event.clientX, event.clientY], { ...props.canvasRect, left: bounds.left, top: bounds.top });
	wheelValue = zoomPreviewViewport(wheelValue!, point, zoom, handle.value.spanAtZoomOne());
	wheelFrame ??= wheelDocument!.defaultView!.requestAnimationFrame(updateWheel);
	if (wheelTimer != null) wheelDocument!.defaultView!.clearTimeout(wheelTimer);
	// ホイールの一連の入力も一つのUndoにし、ドラッグや別の編集へは持ち越さない。
	wheelTimer = wheelDocument!.defaultView!.setTimeout(() => finishWheel(false), 180);
}

watch([() => handle.value?.key ?? null, () => props.canvasRect, appContext.previewPlayback.currentTimelineTime], () => {
	stopDrag?.();
	finishWheel(true);
}, { flush: 'sync' });

onBeforeUnmount(() => { stopDrag?.(); finishWheel(true); });
</script>

<style module lang="scss">
.surface {
	position: absolute;
	cursor: grab;
	touch-action: none;
}
.dragging {
	cursor: grabbing;
}
.label {
	position: absolute;
	left: 8px;
	top: 8px;
	max-width: calc(100% - 16px);
	padding: 4px 8px;
	border-radius: 4px;
	background: #222a;
	color: #fff;
	font-size: 12px;
	pointer-events: none;
	user-select: none;
}
</style>
