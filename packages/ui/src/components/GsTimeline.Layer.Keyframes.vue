<template>
<div :class="$style.root" @dblclick.stop.prevent="onBackgroundDoubleClick">
	<div
		v-for="{ keyframe, prevKeyframe } of keyframeSegments"
		:key="keyframe.id"
		:class="[$style.keyframeBg]"
		:style="{ left: Math.round(timeToDomX(keyframeTime(prevKeyframe.x))) + 'px', width: Math.round(timeToDomX(keyframeTime(keyframe.x))) - Math.round(timeToDomX(keyframeTime(prevKeyframe.x))) + 'px' }"
	></div>
	<div
		v-for="keyframe of keyframes"
		:key="keyframe.id"
		:class="[$style.keyframe, { [$style.selected]: selectedKeyframeId === keyframe.id }]"
		:style="{ left: Math.round(timeToDomX(keyframeTime(keyframe.x))) + 'px' }"
		@mousedown.stop.prevent="onKeyframeMousedown($event, keyframe.id)"
		@dblclick.stop.prevent
	></div>
</div>
</template>

<script lang="ts">
export type KeyframeMove = { keyframeId: string; x: number; mergeKey: string };
</script>

<script lang="ts" setup>
import { computed, onBeforeUnmount } from 'vue';
import { genId } from '@glitch/shared/utility/id.ts';
import type { KeyframesTimelineKeyframe } from '@glitch/shared/types.ts';
import { dragListen } from '@/utility/drag.ts';

const props = defineProps<{
	keyframes: KeyframesTimelineKeyframe[];
	startTime: number;
	tlElWidth: number;
	tlRangeX: number;
	tlPosX: number;
	snapTimes: number[];
	selectedKeyframeId: string | null;
}>();

const emit = defineEmits<{
	(ev: 'select', keyframeId: string): void;
	(ev: 'move', move: KeyframeMove): void;
	(ev: 'insert', x: number): void;
	(ev: 'snap', time: number | null): void;
}>();

function keyframeTime(x: number): number {
	return props.startTime + x;
}

function timeToDomX(time: number): number {
	return ((time - props.tlPosX) / props.tlRangeX) * props.tlElWidth;
}

function onBackgroundDoubleClick(ev: MouseEvent) {
	if (ev.button !== 0 || props.tlElWidth <= 0 || props.tlRangeX <= 0) return;
	stopKeyframeDrag?.();
	const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
	const time = props.tlPosX + (ev.clientX - rect.left) / props.tlElWidth * props.tlRangeX;
	emit('insert', Math.max(0, time - props.startTime));
}

const keyframeSegments = computed(() => {
	const keyframes = props.keyframes.toSorted((a, b) => a.x - b.x);
	return keyframes.slice(1).map((keyframe, index) => ({ keyframe, prevKeyframe: keyframes[index] }));
});

let stopKeyframeDrag: (() => void) | undefined;
const SNAP_THRESHOLD = 5;

function onKeyframeMousedown(ev: MouseEvent, keyframeId: string) {
	if (ev.button !== 0 || props.tlElWidth <= 0 || props.tlRangeX <= 0) return;
	stopKeyframeDrag?.();
	emit('select', keyframeId);
	const keyframes = props.keyframes.toSorted((a, b) => a.x - b.x);
	const index = keyframes.findIndex(keyframe => keyframe.id === keyframeId);
	if (index < 0) return;
	const keyframe = keyframes[index];
	const minX = Math.max(0, keyframes[index - 1]?.x ?? -Infinity);
	const maxX = keyframes[index + 1]?.x ?? Infinity;
	const startTime = props.startTime;
	const baseTime = keyframeTime(keyframe.x);
	const baseClientX = ev.clientX;
	const msPerPixel = props.tlRangeX / props.tlElWidth;
	const mergeKey = genId();
	stopKeyframeDrag = dragListen(event => {
		const point = props.keyframes.find(entry => entry.id === keyframeId);
		if (point == null) { stopKeyframeDrag?.(); return; }
		const draggedTime = baseTime + (event.clientX - baseClientX) * msPerPixel;
		let x = Math.max(minX, Math.min(maxX, draggedTime - startTime));
		let snappingTime: number | null = null;
		const candidates = [...props.snapTimes];
		for (const entry of props.keyframes) {
			if (entry.id !== keyframeId) candidates.push(keyframeTime(entry.x));
		}
		let nearestDistance = SNAP_THRESHOLD;
		for (const time of candidates) {
			const candidateX = time - startTime;
			if (candidateX < minX || candidateX > maxX) continue;
			const distance = Math.abs(time - draggedTime) / msPerPixel;
			if (distance >= nearestDistance) continue;
			nearestDistance = distance;
			x = candidateX;
			snappingTime = time;
		}
		emit('snap', snappingTime);
		if (point.x !== x) emit('move', { keyframeId, x, mergeKey });
	}, () => {
		stopKeyframeDrag = undefined;
		emit('snap', null);
	});
}

onBeforeUnmount(() => stopKeyframeDrag?.());
</script>

<style module lang="scss">
.root {
	--knobSize: 13px; // 奇数にしないとX軸の中心がぴったりにならない

	position: relative;
	height: var(--keyframesLaneHeight);
	line-height: var(--keyframesLaneHeight);
}

.keyframeBg {
	position: absolute;
	top: calc(var(--keyframesLaneHeight) / 2 - var(--knobSize) / 2);
	height: var(--knobSize);
	background: color(from var(--THEME-accent) srgb r g b / 0.25);
}

.keyframe {
	cursor: ew-resize;
	user-select: none;
	position: absolute;
	top: calc(var(--keyframesLaneHeight) / 2 - var(--knobSize) / 2);
	width: var(--knobSize);
	height: var(--knobSize);
	margin-left: calc(var(--knobSize) / -2);
	background: var(--THEME-accent);
	corner-shape: bevel;
	border-radius: 100%;
}

.selected {
	background: var(--THEME-fg);
	box-shadow: 0 0 0 2px var(--THEME-accent);
}
</style>
