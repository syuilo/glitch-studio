<template>
<div :class="$style.root">
	<div
		v-for="{ keyframe, prevKeyframe } of keyframeSegments"
		:key="keyframe.id"
		:class="[$style.keyframeBg]"
		:style="{ left: timelineKeyframePosition(prevKeyframe.x, pixelsPerMs) + 'px', width: timelineKeyframePosition(keyframe.x, pixelsPerMs) - timelineKeyframePosition(prevKeyframe.x, pixelsPerMs) + 'px' }"
	></div>
	<div
		v-for="keyframe of keyframes"
		:key="keyframe.id"
		:class="[$style.keyframe, { [$style.selected]: selectedIds.has(keyframe.id) }]"
		:style="{ left: timelineKeyframePosition(keyframe.x, pixelsPerMs) + 'px' }"
		:data-timeline-keyframe-id="keyframe.id"
		@pointerdown.stop="emit('dragStart', $event, keyframe.id)"
		@click.stop.prevent
		@dblclick.stop.prevent
	></div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { timelineKeyframePosition } from '@/utility/timeline-coordinates.ts';
import type { KeyframesTimelineKeyframe } from '@gs/shared/keyframes/keyframes-timeline.ts';

const props = defineProps<{
	keyframes: KeyframesTimelineKeyframe[];
	pixelsPerMs: number;
	selectedKeyframeIds: string[];
}>();

const emit = defineEmits<{
	(ev: 'dragStart', event: PointerEvent, keyframeId: string): void;
}>();

const selectedIds = computed(() => new Set(props.selectedKeyframeIds));

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
	background: color(from var(--LAYER_COLOR) srgb r g b / 0.25);
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
	background: var(--LAYER_COLOR);
	corner-shape: bevel;
	border-radius: 100%;
}

.selected {
	background: var(--THEME-fg);
	box-shadow: 0 0 0 2px var(--LAYER_COLOR);
}
</style>
