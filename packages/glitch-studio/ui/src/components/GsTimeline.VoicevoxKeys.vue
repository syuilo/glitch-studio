<template>
<div :class="$style.lane" @dblclick.stop.prevent="add">
	<div v-for="range in ranges" :key="range.key" :class="$style.audio" :style="{ left: x(range.startMs) + 'px', width: (range.endMs - range.startMs) * pixelsPerMs + 'px' }"></div>
	<button v-for="utterance in layer.utterances" :key="utterance.id" class="_button" :class="[$style.key, { [$style.selected]: selectedIds.has(utterance.id) }]" :data-timeline-keyframe-id="utterance.id" :style="{ left: keyX(utterance.timeMs) + 'px' }" :title="`${utterance.timeMs} ms: ${utterance.text || '(clear)'}`" @pointerdown.stop="emit('dragStart', $event, utterance.id)" @click.stop.prevent @dblclick.stop.prevent>
		<span>{{ utterance.text || '(clear)' }}</span>
	</button>
</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { insertVoicevoxUtterance } from '@/utility/voicevox-utterance-edit.ts';
import { timelineKeyframePosition } from '@/utility/timeline-coordinates.ts';
import { createSpeechResolver } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import { assignPreparedSpeech, getVoicevoxUtterancePlacements } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox-placement.ts';
import type { TimelineVoicevoxLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { appContext } from '@/app.ts';

const props = defineProps<{ sceneId: string; layer: TimelineVoicevoxLayer; pixelsPerMs: number; offsetMs: number; selectedKeyframeIds: string[] }>();
const emit = defineEmits<{ dragStart: [event: PointerEvent, id: string]; selected: [id: string] }>();
const selectedIds = computed(() => new Set(props.selectedKeyframeIds));
const { stateManager } = appContext.projectContext;
const x = (time: number) => (time - props.offsetMs) * props.pixelsPerMs;
const keyX = (time: number) => timelineKeyframePosition(time, props.pixelsPerMs) - props.offsetMs * props.pixelsPerMs;
const ranges = computed(() => {
	const resolveSpeech = createSpeechResolver(stateManager.state.generatedSpeech.value);
	return getVoicevoxUtterancePlacements(props.layer.voicevox, props.layer.utterances, props.layer.clips).flatMap(placement => {
		const speech = resolveSpeech(placement.request);
		if (!speech) return [];
		const interval = assignPreparedSpeech(placement, speech);
		return interval ? [{ ...interval, key: `${placement.utteranceId}:${placement.clipId}` }] : [];
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
	position: relative;
	height: 32px;
	overflow: hidden;
	touch-action: none;
}

.audio {
	position: absolute;
	top: 26px;
	height: 4px;
	background: color(from var(--LAYER_COLOR) srgb r g b / 0.4);
	pointer-events: none;
}

.key {
	position: absolute;
	top: calc(50% - 6.5px);
	width: 13px;
	height: 13px;
	margin-left: -6.5px;
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

.key span {
	position: absolute;
	left: 18px;
	top: -2px;
	line-height: 17px;
	display: inline-block;
	max-width: 120px;
	overflow: hidden;
	text-overflow: ellipsis;
	font-size: 10px;
	vertical-align: middle;
	pointer-events: none;
}

</style>
