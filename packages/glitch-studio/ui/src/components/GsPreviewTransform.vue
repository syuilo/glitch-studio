<template>
<template v-if="geometry && canvasRect.width > 0 && canvasRect.height > 0">
	<svg ref="overlay" :class="$style.overlay" aria-label="Selected layer transform">
		<polygon :points="polygon" :class="[$style.frame, { [$style.movable]: editable.position }]" @pointerdown="startDrag($event, 'move')"/>
		<line :x1="topHandle[0]" :y1="topHandle[1]" :x2="rotationHandle[0]" :y2="rotationHandle[1]" :class="$style.line"/>
		<rect v-for="(point, index) in handlePositions" :key="index" :x="point[0] - 5" :y="point[1] - 5" width="10" height="10"
			:class="[$style.handle, { [$style.disabled]: !editable.scale || zeroScale }]" :style="{ cursor: resizeCursor(index) }"
			@pointerdown="startDrag($event, previewResizeHandles[index])"/>
		<circle :cx="rotationHandle[0]" :cy="rotationHandle[1]" r="6" :class="[$style.handle, { [$style.disabled]: !editable.rotation }]"
			:style="{ cursor: editable.rotation ? 'grab' : 'not-allowed' }" @pointerdown="startDrag($event, 'rotate')"/>
		<path :d="`M ${origin[0] - 6} ${origin[1]} h 12 M ${origin[0]} ${origin[1] - 6} v 12`" :class="$style.origin"/>
	</svg>
	<div :class="$style.footer" @pointerdown.stop>
		<span :class="$style.layerName">{{ selectedTimelineLayer?.name }}</span>
		<button class="_button" :class="[$style.option, { [$style.active]: snap }]" :aria-pressed="snap" :disabled="dragging"
			title="Snap frame to canvas edges" @click="snap = !snap"><i class="ti ti-magnet"></i> Snap</button>
		<button class="_button" :class="[$style.option, { [$style.active]: keepRatio }]" :aria-pressed="keepRatio" :disabled="dragging"
			title="Keep aspect ratio when resizing corners" @click="keepRatio = !keepRatio"><i class="ti ti-aspect-ratio"></i> Keep ratio</button>
		<button v-if="zeroScale && editable.scale" class="_button" :class="$style.option" :disabled="dragging" @click="resetScale">Reset scale</button>
		<span :class="$style.hint">Alt: origin · Shift: 15° · Esc: cancel</span>
	</div>
</template>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { isTimelineClipActive } from '@gs/subsystems_timeline_shared/timing.ts';
import { getTimelineLayerCorners, timelineSourceToScene } from '@gs/subsystems_timeline_shared/layer-transform.ts';
import type { TimelineLayerGeometry, TimelineLayerTransform, TimelinePoint } from '@gs/subsystems_timeline_shared/layer-transform.ts';
import { appContext } from '@/app.ts';
import { preferences } from '@/preferences.ts';
import { startPreviewPointerDrag } from '@/utility/preview-pointer-drag.ts';
import { previewResizeHandles, sceneToPreview, previewDeltaToScene, resizePreviewLayer, snapPreviewLayerMove, snapPreviewLayerResize, unwrapPreviewRotation } from '@/utility/preview-transform.ts';
import type { PreviewCanvasRect } from '@/utility/preview-transform.ts';
import { canEditTimelineTransform, prepareTimelineTransformBindings, updateTimelineTransformBindings } from '@/utility/timeline-transform-edit.ts';
import type { TimelineTransformBindings, TimelineTransformKey } from '@/utility/timeline-transform-edit.ts';

const props = defineProps<{ canvasRect: PreviewCanvasRect }>();
const { activeSceneId, selectedTimelineLayer, previewPlayback, timelineRendererManagerController } = appContext;
const { stateManager } = appContext.projectContext;
const overlay = useTemplateRef('overlay');
const snap = preferences.model('previewTransformSnap');
const keepRatio = preferences.model('previewTransformKeepRatio');
const dragging = ref(false);
const draft = shallowRef<TimelineLayerGeometry | null>(null);
let stopDrag: (() => void) | undefined;
const transformObserver = {};

const target = computed(() => {
	const layer = selectedTimelineLayer.value;
	if (!preferences.r.showTransformInPreview.value || !timelineRendererManagerController.isReady.value || previewPlayback.state.value.mode !== 'timeline' || previewPlayback.isTimelinePlaying.value
		|| !layer || layer.layerType === 'audio' || layer.isDisabled || activeSceneId.value == null) return null;
	const clip = layer.clips.find(clip => isTimelineClipActive(clip, previewPlayback.currentTimelineTime.value));
	return clip ? { sceneId: activeSceneId.value, layerId: layer.id, clipId: clip.id } : null;
});

watch(() => target.value ? JSON.stringify([target.value.sceneId, target.value.layerId]) : null, async () => {
	stopDrag?.();
	const current = target.value;
	await timelineRendererManagerController.observeLayerTransform(transformObserver, current?.sceneId ?? null, current?.layerId ?? null);
	previewPlayback.refresh();
}, { immediate: true });

const renderedGeometry = computed(() => {
	const current = target.value;
	const preview = timelineRendererManagerController.layerTransform.value;
	return current && preview && preview.request.sceneId === current.sceneId && preview.request.layerId === current.layerId
		&& preview.clipId === current.clipId && preview.time === previewPlayback.currentTimelineTime.value ? preview.geometry : null;
});
const geometry = computed(() => draft.value ?? renderedGeometry.value);
const editable = computed(() => {
	const layer = selectedTimelineLayer.value;
	const bindings: TimelineTransformBindings = layer && layer.layerType !== 'audio' ? layer.compositingParamValues : {};
	return Object.fromEntries((['position', 'scale', 'rotation'] as const).map(key => [key, canEditTimelineTransform(bindings[key], key)])) as Record<TimelineTransformKey, boolean>;
});
const zeroScale = computed(() => geometry.value?.transform.scale.some(value => Math.abs(value) < 0.000001) ?? false);
const toScreen = (point: TimelinePoint) => sceneToPreview(point, props.canvasRect);
const handlePositions = computed(() => geometry.value ? previewResizeHandles.map(point => toScreen(timelineSourceToScene(point, geometry.value!))) : []);
const polygon = computed(() => geometry.value ? getTimelineLayerCorners(geometry.value).map(point => toScreen(point).join(',')).join(' ') : '');
const origin = computed(() => geometry.value ? toScreen(geometry.value.transform.position) : [0, 0]);
const topHandle = computed(() => handlePositions.value[1] ?? [0, 0]);
const rotationHandle = computed(() => {
	if (!geometry.value) return [0, 0];
	const center = toScreen(timelineSourceToScene([0, 0], geometry.value));
	const dx = topHandle.value[0] - center[0];
	const dy = topHandle.value[1] - center[1];
	const length = Math.hypot(dx, dy);
	return length > 0.001 ? [topHandle.value[0] + dx / length * 28, topHandle.value[1] + dy / length * 28] : [center[0], center[1] - 28];
});

function resizeCursor(index: number) {
	if (!editable.value.scale || zeroScale.value) return 'not-allowed';
	const center = geometry.value ? toScreen(timelineSourceToScene([0, 0], geometry.value)) : [0, 0];
	const point = handlePositions.value[index];
	const angle = Math.atan2(point[1] - center[1], point[0] - center[0]);
	return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][(Math.round(angle / (Math.PI / 4)) + 8) % 4];
}

function startDrag(event: PointerEvent, handle: 'move' | 'rotate' | TimelinePoint) {
	if (event.button !== 0 || stopDrag || !target.value || !renderedGeometry.value) return;
	const resizing = Array.isArray(handle);
	if (handle === 'move' && !editable.value.position || handle === 'rotate' && !editable.value.rotation
		|| resizing && (!editable.value.scale || zeroScale.value || !editable.value.position && !event.altKey)) return;
	event.stopPropagation();
	const address = { ...target.value };
	const layer = selectedTimelineLayer.value!;
	if (layer.layerType === 'audio') return;
	const view = (event.currentTarget as Element).ownerDocument.defaultView!;
	const rect = { ...props.canvasRect };
	const overlayRect = overlay.value!.getBoundingClientRect();
	const start: TimelinePoint = [event.clientX, event.clientY];
	const pendingGeometry = deepClone(renderedGeometry.value);
	const keys: TimelineTransformKey[] = handle === 'move' ? ['position'] : handle === 'rotate' ? ['rotation'] : editable.value.position ? ['scale', 'position'] : ['scale'];
	// キーの整数msと表示を揃えてから開始値を採用する。シークの応答を待つ間もcaptureし、
	// 押下位置を保持するので、二回クリックしたり古い時刻の値へ飛んだりしない。
	const time = keys.some(key => layer.compositingParamValues[key]?.inputSource === 'keyframesTimelineInline')
		? Math.round(previewPlayback.currentTimelineTime.value) : previewPlayback.currentTimelineTime.value;
	if (time !== previewPlayback.currentTimelineTime.value) previewPlayback.seekTimeline(time);
	if (!target.value) return;
	// 新時刻の応答待ちでSVGをunmountするとpointer captureまで失われるため、
	// 操作開始時の枠を残し、正しい時刻の評価が届いてから編集を開始する。
	draft.value = pendingGeometry;
	let initial: TimelineLayerGeometry | null = null;
	let session: ReturnType<typeof stateManager.beginEdit<'editTimelineLayerTransform'>> | undefined;
	let prepared: TimelineTransformBindings;
	let initialBindings: TimelineTransformBindings;
	let latest = { x: event.clientX, y: event.clientY, alt: event.altKey, shift: event.shiftKey };
	let frame: number | null = null;
	let previousAngle = 0;
	let accumulatedAngle = 0;
	let changed = false;
	let lastBindings: TimelineTransformBindings | null = null;
	const angleAt = (x: number, y: number) => {
		const center = sceneToPreview(initial!.transform.position, rect);
		return Math.atan2(y - overlayRect.top - center[1], x - overlayRect.left - center[0]);
	};
	const update = () => {
		frame = null;
		if (!initial || !session?.active) return;
		const delta = previewDeltaToScene([latest.x - start[0], latest.y - start[1]], rect);
		if (delta[0] === 0 && delta[1] === 0 && accumulatedAngle === 0 && lastBindings == null) return;
		let transform: TimelineLayerTransform;
		if (handle === 'move') {
			transform = { ...initial.transform, position: [initial.transform.position[0] + delta[0], initial.transform.position[1] + delta[1]] };
			if (snap.value && delta.some(value => value !== 0)) transform = snapPreviewLayerMove({ ...initial, transform }, rect);
		} else if (handle === 'rotate') {
			let rotation = initial.transform.rotation + accumulatedAngle / Math.PI;
			if (latest.shift) rotation = Math.round(rotation * 12) / 12;
			transform = { ...initial.transform, rotation };
		} else {
			transform = resizePreviewLayer(initial, handle, delta, keepRatio.value, latest.alt);
			if (snap.value && delta.some(value => value !== 0)) transform = snapPreviewLayerResize(initial, transform, handle, keepRatio.value, latest.alt, rect);
		}
		changed = keys.some(key => !deepEqual(initial!.transform[key], transform[key]));
		// ポインターを動かさないクリックではキーも履歴も作らない。
		if (!changed && lastBindings == null) return;
		draft.value = { ...initial, transform };
		const bindings = updateTimelineTransformBindings(prepared, transform, time);
		// origin固定など、結果が変わらない項目へはキーを追加しない。途中でAltを
		// 切り替えても同じ項目集合をCommandへ渡し、Undoが開始時の全値を保持する。
		for (const key of keys) if (deepEqual(initial.transform[key], transform[key])) bindings[key] = initialBindings[key];
		if (!deepEqual(bindings, lastBindings)) { session.update({ ...address, bindings }); lastBindings = bindings; }
	};
	const schedule = () => { frame ??= view.requestAnimationFrame(update); };
	const initialize = () => {
		if (initial || !renderedGeometry.value || previewPlayback.currentTimelineTime.value !== time) return;
		initial = deepClone(renderedGeometry.value);
		initialBindings = Object.fromEntries(keys.map(key => [key, deepClone(layer.compositingParamValues[key])]));
		prepared = prepareTimelineTransformBindings(layer.compositingParamValues, keys, time);
		session = stateManager.beginEdit('editTimelineLayerTransform');
		previousAngle = angleAt(start[0], start[1]);
		if (handle === 'rotate') {
			const angle = angleAt(latest.x, latest.y);
			accumulatedAngle = unwrapPreviewRotation(previousAngle, angle);
			previousAngle = angle;
		}
		draft.value = initial;
		schedule();
	};
	const stopWaiting = watch(renderedGeometry, initialize);
	dragging.value = true;
	initialize();
	stopDrag = startPreviewPointerDrag(event, {
		move(next) {
			if (session && !session.active) { stopDrag?.(); return; }
			// origin固定で開始した位置が式の場合、途中でAltを離しても位置を上書きしない。
			latest = { x: next.clientX, y: next.clientY, alt: next.altKey || !keys.includes('position') && resizing, shift: next.shiftKey };
			if (initial && handle === 'rotate') {
				const angle = angleAt(next.clientX, next.clientY);
				accumulatedAngle += unwrapPreviewRotation(previousAngle, angle);
				previousAngle = angle;
			}
			schedule();
		},
		end(cancelled) {
			if (frame != null) view.cancelAnimationFrame(frame);
			if (!cancelled) update();
			stopWaiting();
			if (cancelled || !changed) session?.cancel();
			else session?.finish();
			stopDrag = undefined;
			dragging.value = false;
			// 最後の値がWorkerへ反映されるまで手元の枠を保ち、古い応答へ一瞬戻さない。
			if (cancelled || !changed) draft.value = null;
		},
	});
}

watch(renderedGeometry, value => {
	if (!dragging.value && draft.value && value && deepEqual(value.transform.position, draft.value.transform.position)
		&& deepEqual(value.transform.scale, draft.value.transform.scale) && value.transform.rotation === draft.value.transform.rotation) draft.value = null;
});
watch([() => target.value && JSON.stringify(target.value), previewPlayback.currentTimelineTime, () => props.canvasRect], () => {
	stopDrag?.();
	draft.value = null;
}, { flush: 'sync' });
watch([timelineRendererManagerController.isReady, timelineRendererManagerController.errorMessage], ([ready, error]) => {
	if (!ready || error != null) { stopDrag?.(); draft.value = null; }
});
// 他の設定欄やUndoからの編集はドラッグを確定/取消した後に進む。残った手元の枠も破棄する。
const unsubscribe = stateManager.onChange(() => { if (!dragging.value) draft.value = null; });

function resetScale() {
	const current = target.value;
	const layer = selectedTimelineLayer.value;
	const initial = geometry.value;
	if (!current || !layer || layer.layerType === 'audio' || !initial) return;
	const time = layer.compositingParamValues.scale?.inputSource === 'keyframesTimelineInline'
		? Math.round(previewPlayback.currentTimelineTime.value) : previewPlayback.currentTimelineTime.value;
	previewPlayback.seekTimeline(time);
	const prepared = prepareTimelineTransformBindings(layer.compositingParamValues, ['scale'], time);
	stateManager.commit('editTimelineLayerTransform', { ...current, bindings: updateTimelineTransformBindings(prepared, { ...initial.transform, scale: [1, 1] }, time) });
}

onBeforeUnmount(() => {
	stopDrag?.();
	unsubscribe();
	void timelineRendererManagerController.observeLayerTransform(transformObserver, null, null);
});
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
.frame {
	fill: transparent;
	stroke: var(--THEME-accent);
	stroke-width: 1;
	pointer-events: all;
	touch-action: none;
}
.movable {
	cursor: move;
}
.line, .origin {
	stroke: var(--THEME-accent);
	stroke-width: 1;
	fill: none;
}
.origin {
	stroke-width: 2;
}
.handle {
	fill: #fff;
	stroke: #222;
	stroke-width: 1;
	pointer-events: all;
	touch-action: none;
}
.disabled {
	fill: #999;
}
.footer {
	position: absolute;
	bottom: 0;
	left: 0;
	right: 0;
	min-height: 32px;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 4px 8px;
	background: #161616ed;
	border-top: 1px solid #ffffff20;
	font-size: 11px;
	flex-wrap: wrap;
}
.layerName {
	max-width: 140px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.option {
	display: inline-flex;
	gap: 4px;
	align-items: center;
	padding: 4px 7px;
	border-radius: 4px;
	white-space: nowrap;
}
.option:hover {
	background: #ffffff20;
}
.active {
	color: var(--THEME-accent);
	background: #ffffff12;
}
.hint {
	opacity: 0.6;
	margin-left: auto;
}
</style>
