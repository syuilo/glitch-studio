<template>
<div :class="$style.root" :data-timeline-clip-id="clip.id">
	<div :class="$style.topLane">
		<div v-if="mediaClip" :style="{ left: clip.startMs * pixelsPerMs + 'px', width: clip.durationMs * pixelsPerMs + 'px' }" :class="$style.clipTopHandleArea">
			<div v-tooltip.bottom="'Trim source end'" :class="[$style.topTrimHandle]" :style="{ right: (clip.durationMs - Math.min(clip.durationMs, periodMs)) * pixelsPerMs + 'px' }" @pointerdown.stop="emit('trimStart', $event, 'end')"></div>
		</div>
	</div>
	<div :class="$style.mainLane">
		<div v-if="selected && sourceGhost" :class="$style.sourceGhost" :style="{ left: sourceGhost.startMs * pixelsPerMs + 'px', width: sourceGhost.durationMs * pixelsPerMs + 'px' }"></div>
		<div
			:class="[$style.clip, { [$style.selected]: selected, [$style.active]: active, [$style.moving]: moving }]"
			:style="{ left: clip.startMs * pixelsPerMs + 'px', width: clip.durationMs * pixelsPerMs + 'px' }"
			@pointerdown.stop="emit('moveStart', $event)"
			@click.stop
			@dblclick.stop
			@contextmenu.stop.prevent="emit('contextMenu', $event)"
		>
			<div :class="$style.clipInner">
				<div v-if="mediaClip?.loop" :class="$style.loopFill" :style="{ left: periodMs * pixelsPerMs + 'px', '--loopPeriod': Math.max(6, periodMs * pixelsPerMs) + 'px', '--loopLine': periodMs * pixelsPerMs >= 6 ? '#fff8' : 'transparent' }"></div>
				<div :class="$style.clipInnerLeft">
					<div v-tooltip.bottom="'Trim source start'" :class="[$style.trimStart]" @pointerdown.stop="emit('trimStart', $event, 'start')"></div>
				</div>
				<div :class="$style.clipInnerCenter">
					<div :class="$style.clipLabel"><GsCondensedLine>{{ label }}</GsCondensedLine></div>
					<div v-if="mediaClip" :class="$style.clipLabel"><GsCondensedLine><template v-if="'sourceTimeMs' in clip"> · Hold {{ formatTimelineTimecode(clip.sourceTimeMs) }}</template><template v-else-if="mediaClip && mediaClip.playbackRate !== 1"> · {{ mediaClip.playbackRate < 0 ? 'Reverse ' : '' }}{{ Math.abs(mediaClip.playbackRate) }}×</template></GsCondensedLine></div>
				</div>
				<div :class="$style.clipInnerRight">
					<div v-if="!mediaClip" v-tooltip.bottom="'Trim source end'" :class="[$style.trimEnd]" :style="{ right: (clip.durationMs - Math.min(clip.durationMs, periodMs)) * pixelsPerMs + 'px' }" @pointerdown.stop="emit('trimStart', $event, 'end')"></div>
					<div v-if="mediaClip" v-tooltip.bottom="'Extend to loop the trimmed range'" :class="[ $style.loopEnd]" @pointerdown.stop="emit('trimStart', $event, 'loop')"><i class="ti ti-repeat"></i></div>
				</div>
			</div>
		</div>
	</div>
	<div :class="$style.bottomLane">
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { getTimelineMediaPeriod } from '@gs/subsystems_timeline_shared/media-timing.ts';
import GsCondensedLine from './common/GsCondensedLine.vue';
import type { TimelineClip } from '@gs/subsystems_timeline_shared/clip.ts';
import { formatTimelineTimecode } from '@/utility/timeline-ticks.ts';

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
	if ('sourceTimeMs' in clip) return null;
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
.root {
	position: absolute;
	display: flex;
	flex-direction: column;
	height: var(--MAIN_LANE_HEIGHT);
}

.topLane {
	position: relative;
}

.mainLane {
	position: relative;
	flex: 1;
	min-height: 0;
}

.bottomLane {
	position: relative;
}

.sourceGhost {
	position: absolute;
	bottom: 0;
	height: 100%;
	box-sizing: border-box;
	background: color-mix(in srgb, var(--LAYER_COLOR) 15%, transparent);
	border: 1px dashed color-mix(in srgb, var(--LAYER_COLOR) 45%, transparent);
	pointer-events: none;
}

.clip {
	position: absolute;
	height: 100%;
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
}

.clipTopHandleArea {
	position: relative;
	height: 20px;
}

.topTrimHandle {
	position: absolute;
	top: 0;
	right: 0;
	width: min(8px, 25%);
	height: 100%;
	background: var(--LAYER_COLOR);
	border-radius: 0 0 0 8px;
	corner-shape: bevel;
	cursor: ew-resize;
	touch-action: none;

	&:hover {
		background: #fff;
	}
}

.clipInner {
	position: relative;
	height: 100%;
	display: flex;
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
	.clipInner {
		box-shadow: inset 0 0 0 2px #fff;
	}
}
.active {
	.clipInner {
		background: var(--LAYER_COLOR);
	}
}
.moving {
	.clipInner {
		cursor: grabbing;
	}
}

.clipInnerLeft {
	position: relative;
	z-index: 1;
}

.clipInnerCenter {
	position: relative;
	z-index: 1;
	flex: 1;
	min-width: 0;
	box-sizing: border-box;
}

.clipInnerRight {
	position: relative;
	z-index: 1;
	display: flex;
	flex-direction: column;
}

.clipLabel {
	overflow: clip;
}

.trimStart {
	width: 8px;
	height: 100%;
	cursor: ew-resize;
	touch-action: none;
	&:hover {
		background: #fff8;
	}
}
.trimEnd {
	width: 8px;
	height: 100%;
	cursor: ew-resize;
	touch-action: none;
	&:hover {
		background: #fff8;
	}
}
.loopEnd {
	height: 50%;
	width: 20px;
	margin-top: auto;
	display: flex;
	align-items: center;
	justify-content: center;
	background: hsl(from var(--LAYER_COLOR) h s calc(l + 10));
	border-radius: 6px 0 0 0;
	corner-shape: bevel;
	font-size: 90%;
	//cursor: url('cursor/loop-right-handle.svg'), auto;
	cursor: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%23fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-arrow-iteration"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M8.5 16a5.5 5.5 0 1 0 -5.5 -5.5v.5" /><path d="M3 16h18" /><path d="M18 13l3 3l-3 3" /></svg>') 8 8, auto;
}

.loopFill {
	position: absolute;
	top: 0;
	bottom: 0;
	right: 0;
	pointer-events: none;
	background-image: repeating-linear-gradient(90deg, var(--loopLine) 0 1px, transparent 1px var(--loopPeriod)), repeating-linear-gradient(135deg, #0003 0 4px, transparent 4px 8px);
}
</style>
