<template>
<svg v-if="handles.length > 0" ref="overlay" :class="$style.overlay" data-test-preview-parameter-overlay @pointermove.stop>
	<g v-for="handle in handles" :key="handle.key" :data-test-preview-parameter-handle="handle.key">
		<circle :cx="handle.point[0]" :cy="handle.point[1]" r="9" :class="$style.handle" @pointerdown="startDrag($event, handle)"/>
		<path :d="`M ${handle.point[0] - 5} ${handle.point[1]} h 10 M ${handle.point[0]} ${handle.point[1] - 5} v 10`" :class="$style.cross"/>
		<line :x1="handle.point[0] + 9" :y1="handle.point[1]" :x2="handle.point[0] + 16" :y2="handle.labelY - 4" :class="$style.cross"/>
		<text :x="handle.point[0] + 18" :y="handle.labelY" :class="$style.label" @pointerdown="startDrag($event, handle)">{{ handle.label() }}</text>
	</g>
</svg>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, useTemplateRef, watch } from 'vue';
import { appContext } from '@/app.ts';
import { startPreviewPointerDrag } from '@/utility/preview-pointer-drag.ts';
import { previewParameterToScreen, previewScreenToParameter, snapPreviewParameterPosition } from '@/utility/preview-parameter-position.ts';
import type { PreviewCanvasRect } from '@/utility/preview-transform.ts';
import type { PreviewParameterHandle, PreviewParameterPoint } from '@/utility/preview-parameter-editing.ts';

const props = defineProps<{ canvasRect: PreviewCanvasRect; showGrid: boolean }>();
const editing = appContext.previewParameterEditing;
const overlay = useTemplateRef('overlay');
const draft = shallowRef<{ key: string; position: PreviewParameterPoint } | null>(null);
let stopDrag: (() => void) | null = null;
const handles = computed(() => {
	if (props.canvasRect.width <= 0 || props.canvasRect.height <= 0) return [];
	const positions: PreviewParameterPoint[] = [];
	return editing.handles.value.flatMap(handle => {
		const position = draft.value?.key === handle.key ? draft.value.position : handle.position();
		if (position == null) return [];
		const point = previewParameterToScreen(position, props.canvasRect);
		// 初期位置が同じ複数点も、ずらしたラベルを掴んで個別に編集できるようにする。
		const overlapCount = positions.filter(previous => Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 24).length;
		positions.push(point);
		return [{ ...handle, point, labelY: point[1] - 12 + overlapCount * 22 }];
	});
});

function startDrag(event: PointerEvent, handle: PreviewParameterHandle) {
	if (event.button !== 0 || stopDrag != null || overlay.value == null) return;
	event.stopPropagation();
	const session = handle.begin();
	if (session == null) return;
	const rect = { ...props.canvasRect };
	const overlayRect = overlay.value.getBoundingClientRect();
	const view = overlay.value.ownerDocument.defaultView!;
	const start = previewScreenToParameter([event.clientX - overlayRect.left, event.clientY - overlayRect.top], rect);
	let latest: PreviewParameterPoint = [...session.initialPosition];
	let moved = false;
	let frame: number | null = null;
	const update = () => {
		frame = null;
		if (!session.active) { stopDrag?.(); return; }
		if (!moved) return;
		const position = snapPreviewParameterPosition(latest, rect, props.showGrid);
		draft.value = { key: handle.key, position };
		session.update(position);
	};
	draft.value = { key: handle.key, position: session.initialPosition };
	stopDrag = startPreviewPointerDrag(event, {
		move(next) {
			const point = previewScreenToParameter([next.clientX - overlayRect.left, next.clientY - overlayRect.top], rect);
			moved ||= next.clientX !== event.clientX || next.clientY !== event.clientY;
			latest = [session.initialPosition[0] + point[0] - start[0], session.initialPosition[1] + point[1] - start[1]];
			frame ??= view.requestAnimationFrame(update);
		},
		end(cancelled) {
			if (frame != null) view.cancelAnimationFrame(frame);
			// 外部コマンドがセッションを確定済みの場合、古いドラッグから値を上書きしない。
			if (!cancelled && session.active) update();
			if (cancelled) session.cancel();
			else session.finish();
			stopDrag = null;
			draft.value = null;
		},
	});
}

watch([() => editing.handles.value.map(handle => handle.key).join(','), () => props.canvasRect,
	appContext.previewPlayback.currentTimelineTime], () => stopDrag?.(), { flush: 'sync' });

onBeforeUnmount(() => stopDrag?.());
</script>

<style module lang="scss">
.overlay {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	overflow: visible;
	pointer-events: none;
}
.handle {
	fill: var(--THEME-accent);
	stroke: #fff;
	stroke-width: 2;
	pointer-events: all;
	cursor: move;
	touch-action: none;
}
.cross {
	stroke: #fff;
	stroke-width: 1;
	fill: none;
	pointer-events: none;
}
.label {
	fill: #fff;
	stroke: #222;
	stroke-width: 3;
	paint-order: stroke;
	font-size: 12px;
	pointer-events: all;
	cursor: move;
	touch-action: none;
	user-select: none;
}
</style>
