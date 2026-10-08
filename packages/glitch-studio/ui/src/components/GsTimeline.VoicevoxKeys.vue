<template>
<div :class="$style.lane" @dblclick.stop.prevent="add">
	<div v-for="range in ranges" :key="range.key" :class="$style.audio" :style="{ left: x(range.startMs) + 'px', width: (range.endMs - range.startMs) * pixelsPerMs + 'px' }">
		<span :class="$style.serif"><GsCondensedLine>{{ range.text }}</GsCondensedLine></span>
	</div>
	<button
		v-for="utterance in layer.utterances"
		:key="utterance.id"
		class="_button"
		:class="[$style.key, { [$style.selected]: selectedIds.has(utterance.id) }]"
		:data-timeline-keyframe-id="utterance.id"
		:style="{ left: keyX(utterance.timeMs) + 'px' }"
		@pointerdown.stop="emit('dragStart', $event, utterance.id)"
		@click.stop.prevent
		@dblclick.stop.prevent
	></button>
</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { createSpeechResolver } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import { assignPreparedSpeech, getVoicevoxUtterancePlacements } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox-placement.ts';
import type { TimelineVoicevoxLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { timelineKeyframePosition } from '@/utility/timeline-coordinates.ts';
import { insertVoicevoxUtterance } from '@/utility/voicevox-utterance-edit.ts';
import { appContext } from '@/app.ts';
import GsCondensedLine from '@/components/common/GsCondensedLine.vue';

const props = defineProps<{ sceneId: string; layer: TimelineVoicevoxLayer; pixelsPerMs: number; offsetMs: number; selectedKeyframeIds: string[] }>();
const emit = defineEmits<{ dragStart: [event: PointerEvent, id: string]; selected: [id: string] }>();
const selectedIds = computed(() => new Set(props.selectedKeyframeIds));
const { stateManager } = appContext.projectContext;
const x = (time: number) => (time - props.offsetMs) * props.pixelsPerMs;
const keyX = (time: number) => timelineKeyframePosition(time, props.pixelsPerMs) - props.offsetMs * props.pixelsPerMs;
const ranges = computed(() => {
	const resolveSpeech = createSpeechResolver(stateManager.state.generatedSpeech.value);
	const utteranceTexts = new Map(props.layer.utterances.map(utterance => [utterance.id, utterance.text]));
	return getVoicevoxUtterancePlacements(props.layer.voicevox, props.layer.utterances, props.layer.clips).flatMap(placement => {
		const speech = resolveSpeech(placement.request);
		if (!speech) return [];
		const interval = assignPreparedSpeech(placement, speech);
		return interval ? [{ ...interval, key: `${placement.utteranceId}:${placement.clipId}`, text: utteranceTexts.get(placement.utteranceId) ?? '' }] : [];
	});
});

function add(event: MouseEvent) {
	if (event.button !== 0 || props.pixelsPerMs <= 0) return;
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
	const timeMs = props.offsetMs + (event.clientX - rect.left) / props.pixelsPerMs;
	const inserted = insertVoicevoxUtterance(props.layer.utterances, timeMs);
	if (!inserted) return;
	if (inserted.utterances !== props.layer.utterances) stateManager.commit('editVoicevoxLayer', {
		sceneId: props.sceneId, layerId: props.layer.id, voicevox: props.layer.voicevox,
		utterances: [...inserted.utterances],
	});
	emit('selected', inserted.utterance.id);
}
</script>

<style module>
.lane {
	--lane-height: 32px;
	--key-size: 17px;

	position: relative;
	height: var(--lane-height);
	overflow: clip;
	touch-action: none;
}

.audio {
	position: absolute;
	top: 0;
	bottom: 0;
	margin: auto 0;
	height: var(--key-size);
	background: color(from var(--LAYER_COLOR) srgb r g b / 0.5);
	color: var(--THEME-fg);
	overflow: clip;
	pointer-events: none;
}

.key {
	position: absolute;
	top: 0;
	bottom: 0;
	margin: auto 0;
	width: var(--key-size);
	height: var(--key-size);
	margin-left: calc(var(--key-size) / -2);
	background: var(--LAYER_COLOR);
	color: var(--THEME-fg);
	corner-shape: bevel;
	border-radius: 100%;
	white-space: nowrap;
	cursor: ew-resize;
	touch-action: none;
}

.selected {
	background: var(--THEME-fg);
	box-shadow: 0 0 0 2px var(--LAYER_COLOR);
}

.serif {
	position: absolute;
	top: 0;
	left: calc(var(--key-size) / 2 + 4px);
	right: 4px;
	line-height: var(--key-size);
	font-size: 95%;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	pointer-events: none;
}
</style>
