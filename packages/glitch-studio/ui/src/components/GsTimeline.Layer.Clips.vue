<template>
<div :class="$style.root">
	<XClip
		v-for="item in items"
		:key="item.clip.id"
		:clip="item.clip"
		:label="item.label"
		:sourceDurationMs="item.sourceDurationMs"
		:pixelsPerMs="pixelsPerMs"
		:selected="selectedIds.has(item.clip.id)"
		:active="!isDisabled && isTimelineClipActive(item.clip, sceneTimeMs)"
		:moving="moving && selectedIds.has(item.clip.id)"
		@moveStart="event => emit('moveStart', event, item.clip.id)"
		@trimStart="(event, edge) => emit('trimStart', event, item.clip.id, edge)"
	/>
</div>
</template>

<script lang="ts">
import type { TimelineClip } from '@gs/subsystems_timeline_shared/clip.ts';

export type TimelineClipPresentation = { clip: TimelineClip; label: string; sourceDurationMs: number | null };
</script>

<script setup lang="ts">
import { computed } from 'vue';
import { isTimelineClipActive } from '@gs/subsystems_timeline_shared/timing.ts';
import XClip from './GsTimeline.Clip.vue';

// スクロール位置を受け取らず、一覧のv-forも横移動から独立させる。
// 素材範囲の背景はXClip内にあり、本体と一緒に外側の親要素で移動する。
const props = defineProps<{
	items: TimelineClipPresentation[];
	pixelsPerMs: number;
	sceneTimeMs: number;
	isDisabled: boolean;
	selectedClipIds: string[];
	moving: boolean;
}>();
const emit = defineEmits<{
	(ev: 'moveStart', event: PointerEvent, clipId: string): void;
	(ev: 'trimStart', event: PointerEvent, clipId: string, edge: 'start' | 'end'): void;
}>();
const selectedIds = computed(() => new Set(props.selectedClipIds));
</script>

<style module>
.root {
	position: relative;
	height: 100%;
}
</style>
