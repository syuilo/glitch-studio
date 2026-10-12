<template>
<div v-if="selected && sourceGhost" :class="$style.sourceGhost" :style="{ left: sourceGhost.startMs * pixelsPerMs + 'px', width: sourceGhost.durationMs * pixelsPerMs + 'px' }"></div>
<div
	:data-timeline-clip-id="clip.id"
	:class="[$style.clip, { [$style.selected]: selected, [$style.active]: active, [$style.moving]: moving }]"
	:style="{ left: clip.startMs * pixelsPerMs + 'px', width: clip.durationMs * pixelsPerMs + 'px' }"
	@pointerdown.stop="emit('moveStart', $event)"
	@click.stop
	@dblclick.stop
	@contextmenu.stop.prevent="emit('contextMenu', $event)"
>
	<div v-if="mediaClip?.loop" :class="$style.loopFill" :style="{ left: periodMs * pixelsPerMs + 'px', '--loopPeriod': Math.max(6, periodMs * pixelsPerMs) + 'px', '--loopLine': periodMs * pixelsPerMs >= 6 ? '#fff5' : 'transparent' }"></div>
	<div style="padding: 0 8px;"><GsCondensedLine>{{ label }}<template v-if="mediaClip && mediaClip.playbackRate !== 1"> · {{ mediaClip.playbackRate < 0 ? 'Reverse ' : '' }}{{ Math.abs(mediaClip.playbackRate) }}×</template></GsCondensedLine></div>
	<div :class="[$style.trimHandle, $style.trimStart]" title="Trim source start" @pointerdown.stop="emit('trimStart', $event, 'start')"></div>
	<div :class="[$style.trimHandle, $style.trimEnd, { [$style.mediaTrimEnd]: mediaClip }]" :style="{ right: (clip.durationMs - Math.min(clip.durationMs, periodMs)) * pixelsPerMs + 'px' }" title="Trim source end" @pointerdown.stop="emit('trimStart', $event, 'end')"></div>
	<div v-if="mediaClip" :class="[$style.trimHandle, $style.loopEnd]" title="Extend to loop the trimmed range" aria-label="Resize media loop" @pointerdown.stop="emit('trimStart', $event, 'loop')"><i class="ti ti-repeat"></i></div>
</div>
</template>

<script lang="ts" setup>
import GsCondensedLine from './common/GsCondensedLine.vue';
import { computed } from 'vue';
import { getTimelineMediaPeriod } from '@gs/subsystems_timeline_shared/media-timing.ts';
import type { TimelineClip } from '@gs/subsystems_timeline_shared/clip.ts';

const props = defineProps<{
	clip: TimelineClip;
	label: string;
	sourceDurationMs: number | null;
	pixelsPerMs: number;
	selected: boolean;
	active: boolean;
	moving: boolean;
}>();
const mediaClip = computed(() => 'sourceInMs' in props.clip ? props.clip : null);
const periodMs = computed(() => mediaClip.value ? getTimelineMediaPeriod(mediaClip.value) : props.clip.durationMs);
const sourceGhost = computed(() => {
	if (props.sourceDurationMs == null) return null;
	const clip = props.clip;
	if ('contentOffsetMs' in clip) return { startMs: clip.startMs - clip.contentOffsetMs, durationMs: props.sourceDurationMs };
	const speed = Math.abs(clip.playbackRate);
	const before = clip.playbackRate > 0 ? clip.sourceInMs : props.sourceDurationMs - clip.sourceOutMs;
	return { startMs: clip.startMs - before / speed, durationMs: props.sourceDurationMs / speed };
});
const emit = defineEmits<{
	(ev: 'moveStart', event: PointerEvent): void;
	(ev: 'trimStart', event: PointerEvent, edge: 'start' | 'end' | 'loop'): void;
	(ev: 'contextMenu', event: PointerEvent): void;
}>();

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
.selected {
	box-shadow: inset 0 0 0 2px var(--THEME-fg);
}
.active {
	background: var(--LAYER_COLOR);
}
.moving {
	cursor: grabbing;
}
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
	&:hover {
		background: #fff8;
	}
}
.trimStart {
	left: 0;
}
.trimEnd {
	right: 0;
}
.mediaTrimEnd {
	bottom: 50%;
	background: #ffffff30;
}
.loopEnd {
	top: 50%;
	right: 0;
	width: min(20px, 50%);
	display: flex;
	align-items: center;
	justify-content: center;
	background: #0005;
	font-size: 12px;
}
.loopFill {
	position: absolute;
	top: 0;
	bottom: 0;
	right: 0;
	pointer-events: none;
	background-image: repeating-linear-gradient(90deg, var(--loopLine) 0 1px, transparent 1px var(--loopPeriod)), repeating-linear-gradient(135deg, #0002 0 4px, transparent 4px 8px);
}
</style>
