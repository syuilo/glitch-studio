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
		:class="[$style.keyframe, { [$style.selected]: selectedKeyframeIds.includes(keyframe.id) }]"
		:style="{ left: Math.round(timeToDomX(keyframeTime(keyframe.x))) + 'px' }"
		:data-timeline-keyframe-id="keyframe.id"
		@pointerdown.stop="emit('dragStart', $event, keyframe.id)"
		@click.stop.prevent
		@dblclick.stop.prevent
	></div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { KeyframesTimelineKeyframe } from '@glitch/shared/types.ts';

const props = defineProps<{
	keyframes: KeyframesTimelineKeyframe[];
	startTime: number;
	tlElWidth: number;
	tlRangeX: number;
	tlPosX: number;
	selectedKeyframeIds: string[];
}>();

const emit = defineEmits<{
	(ev: 'dragStart', event: PointerEvent, keyframeId: string): void;
	(ev: 'insert', x: number): void;
}>();

function keyframeTime(x: number): number {
	return props.startTime + x;
}

function timeToDomX(time: number): number {
	return ((time - props.tlPosX) / props.tlRangeX) * props.tlElWidth;
}

function onBackgroundDoubleClick(ev: MouseEvent) {
	if (ev.button !== 0 || props.tlElWidth <= 0 || props.tlRangeX <= 0) return;
	const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
	const time = props.tlPosX + (ev.clientX - rect.left) / props.tlElWidth * props.tlRangeX;
	emit('insert', Math.max(0, time - props.startTime));
}

const keyframeSegments = computed(() => {
	const keyframes = props.keyframes.toSorted((a, b) => a.x - b.x);
	return keyframes.slice(1).map((keyframe, index) => ({ keyframe, prevKeyframe: keyframes[index] }));
});

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
	touch-action: none;
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
