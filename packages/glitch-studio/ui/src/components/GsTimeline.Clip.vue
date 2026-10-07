<template>
<div v-if="selected && sourceDurationMs != null" :class="$style.sourceGhost" :style="{ left: timeToDomX(clip.startMs - clip.contentOffsetMs) + 'px', width: sourceDurationMs / tlRangeX * tlElWidth + 'px' }"></div>
<div
	:data-timeline-clip-id="clip.id"
	:class="[$style.clip, { [$style.selected]: selected, [$style.active]: active, [$style.moving]: moving }]"
	:style="{ left: timeToDomX(clip.startMs) + 'px', width: clip.durationMs / tlRangeX * tlElWidth + 'px' }"
	@pointerdown.stop="emit('moveStart', $event)"
	@click.stop
	@dblclick.stop
>
	<div style="padding: 0 8px;"><GsCondensedLine>{{ label }}</GsCondensedLine></div>
	<div :class="[$style.trimHandle, $style.trimStart]" @pointerdown.stop="emit('trimStart', $event, 'start')"></div>
	<div :class="[$style.trimHandle, $style.trimEnd]" @pointerdown.stop="emit('trimStart', $event, 'end')"></div>
</div>
</template>

<script lang="ts" setup>
import GsCondensedLine from './common/GsCondensedLine.vue';
import { timelineTimeToX } from '@/utility/timeline-coordinates.ts';
import type { TimelineClip } from '@gs/subsystems_timeline_shared/clip.ts';

const props = defineProps<{
	clip: TimelineClip;
	label: string;
	sourceDurationMs: number | null;
	tlElWidth: number;
	tlRangeX: number;
	tlPosX: number;
	selected: boolean;
	active: boolean;
	moving: boolean;
}>();
const emit = defineEmits<{
	(ev: 'moveStart', event: PointerEvent): void;
	(ev: 'trimStart', event: PointerEvent, edge: 'start' | 'end'): void;
}>();

function timeToDomX(time: number): number {
	return timelineTimeToX(time, props.tlPosX, props.tlRangeX, props.tlElWidth);
}
</script>

<style module lang="scss">
.clip {
	position: absolute;
	height: var(--mainLaneHeight);
	box-sizing: border-box;
	overflow: clip;
	cursor: grab;
	touch-action: none;
	user-select: none;
	background: color-mix(in srgb, var(--LAYER_COLOR) 75%, #000);
	color: var(--THEME-fgOnAccent);
	border-radius: 8px 0 0 0;
	corner-shape: bevel;
}
.selected { box-shadow: inset 0 0 0 2px var(--THEME-fg); }
.active { background: var(--LAYER_COLOR); }
.moving { cursor: grabbing; }
.sourceGhost {
	position: absolute;
	height: var(--mainLaneHeight);
	box-sizing: border-box;
	background: color-mix(in srgb, var(--LAYER_COLOR) 15%, transparent);
	border: 1px dashed color-mix(in srgb, var(--LAYER_COLOR) 45%, transparent);
	pointer-events: none;
}
.trimHandle {
	position: absolute;
	top: 0;
	bottom: 0;
	width: min(8px, 25%);
	cursor: ew-resize;
	touch-action: none;
	&:hover { background: #fff8; }
}
.trimStart { left: 0; }
.trimEnd { right: 0; }
</style>
