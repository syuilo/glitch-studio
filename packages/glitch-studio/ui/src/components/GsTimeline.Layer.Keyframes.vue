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
	<div
		v-for="{ keyframe, label, nextKeyframe } of enumKeyframeLabels"
		:key="keyframe.id"
		:class="$style.keyframeLabel"
		:style="{
			left: timelineKeyframePosition(keyframe.x, pixelsPerMs) + 'px',
			maxWidth: nextKeyframe ? `max(0px, calc(${timelineKeyframePosition(nextKeyframe.x, pixelsPerMs) - timelineKeyframePosition(keyframe.x, pixelsPerMs)}px - var(--knobSize) - 8px))` : undefined,
		}"
	>
		{{ label }}
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import type { KeyframesTimelineKeyframe } from '@gs/shared/keyframes/keyframes-timeline.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import { timelineKeyframePosition } from '@/utility/timeline-coordinates.ts';

const props = defineProps<{
	keyframes: KeyframesTimelineKeyframe[];
	paramDef: ParameterDefinition | undefined;
	pixelsPerMs: number;
	selectedKeyframeIds: string[];
}>();

const emit = defineEmits<{
	(ev: 'dragStart', event: PointerEvent, keyframeId: string): void;
}>();

const selectedIds = computed(() => new Set(props.selectedKeyframeIds));

const enumKeyframeLabels = computed(() => {
	const definition = props.paramDef;
	if (!definition || !isParameterType(definition, 'enum')) return [];
	const keyframes = props.keyframes.toSorted((a, b) => a.x - b.x);
	return keyframes.map((keyframe, index) => ({
		keyframe,
		label: definition.ui.control.labels[String(keyframe.value)] ?? String(keyframe.value),
		nextKeyframe: keyframes[index + 1],
	}));
});

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

.keyframeLabel {
	position: absolute;
	top: 0;
	// キーの右端から4px離し、ラベルでキーの選択・ドラッグを遮らない。
	margin-left: calc(var(--knobSize) / 2 + 4px);
	font-size: 90%;
	text-align: left;
	white-space: nowrap;
	overflow: clip;
	text-overflow: ellipsis;
	pointer-events: none;
	user-select: none;
}
</style>
