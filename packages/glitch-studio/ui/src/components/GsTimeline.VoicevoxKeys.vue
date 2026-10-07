<template>
<div :class="$style.lane" @dblclick.stop.prevent="add">
	<div v-for="range in ranges" :key="range.key" :class="$style.audio" :style="{ left: x(range.startMs) + 'px', width: (range.endMs - range.startMs) * pixelsPerMs + 'px' }"></div>
	<button v-for="utterance in layer.utterances" :key="utterance.id" class="_button" :class="$style.key" :style="{ left: x(utterance.timeMs) + 'px' }" :title="`${utterance.timeMs} ms: ${utterance.text || '(clear)'}`" @pointerdown.stop.prevent="drag($event, utterance)" @dblclick.stop>
		◆ <span>{{ utterance.text || '(clear)' }}</span>
	</button>
</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue';
import { genId } from '@gs/shared/utility/id.ts';
import { getVoicevoxRequest, getVoicevoxRequestKey } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import type { VoicevoxUtterance } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import type { TimelineVoicevoxLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { appContext } from '@/app.ts';

const props = defineProps<{ sceneId: string; layer: TimelineVoicevoxLayer; pixelsPerMs: number; offsetMs: number }>();
const { stateManager } = appContext.projectContext;
const x = (time: number) => (time - props.offsetMs) * props.pixelsPerMs;
const ranges = computed(() => {
	const utterances = props.layer.utterances.toSorted((a, b) => a.timeMs - b.timeMs);
	return utterances.flatMap((utterance, index) => {
		if (!utterance.text) return [];
		const key = getVoicevoxRequestKey(getVoicevoxRequest(props.layer.voicevox, utterance));
		const speech = stateManager.state.generatedSpeech.value.find(item => item.key === key);
		if (!speech) return [];
		return props.layer.clips.flatMap(clip => {
			const startMs = Math.max(utterance.timeMs, clip.startMs);
			const endMs = Math.min(utterance.timeMs + speech.durationMs, utterances[index + 1]?.timeMs ?? Infinity, clip.startMs + clip.durationMs);
			return endMs > startMs ? [{ key: `${utterance.id}:${clip.id}`, startMs, endMs }] : [];
		});
	});
});

function add(event: MouseEvent) {
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
	const timeMs = Math.max(0, Math.round(props.offsetMs + (event.clientX - rect.left) / props.pixelsPerMs));
	if (!Number.isSafeInteger(timeMs) || props.layer.utterances.some(item => item.timeMs === timeMs)) return;
	stateManager.commit('editVoicevoxLayer', {
		sceneId: props.sceneId, layerId: props.layer.id, voicevox: props.layer.voicevox,
		utterances: [...props.layer.utterances, { id: genId(), timeMs, text: '', reading: null }],
	});
}

let cancelDrag: (() => void) | undefined;
onBeforeUnmount(() => cancelDrag?.());

function drag(event: PointerEvent, utterance: VoicevoxUtterance) {
	if (event.button !== 0 || props.pixelsPerMs <= 0) return;
	cancelDrag?.();
	const element = event.currentTarget as HTMLElement;
	const startX = event.clientX;
	const pixelsPerMs = props.pixelsPerMs;
	const ownerWindow = element.ownerDocument.defaultView;
	const original = props.layer.utterances.map(item => ({ ...item }));
	const settings = { ...props.layer.voicevox };
	const session = stateManager.beginEdit('editVoicevoxLayer');
	const move = (next: PointerEvent) => {
		if (next.pointerId !== event.pointerId) return;
		const timeMs = Math.max(0, Math.round(utterance.timeMs + (next.clientX - startX) / pixelsPerMs));
		if (!Number.isSafeInteger(timeMs) || original.some(item => item.id !== utterance.id && item.timeMs === timeMs)) return;
		session.update({
			sceneId: props.sceneId, layerId: props.layer.id, voicevox: settings,
			utterances: original.map(item => item.id === utterance.id ? { ...item, timeMs } : item),
		});
	};
	const cleanup = () => {
		element.removeEventListener('pointermove', move);
		element.removeEventListener('pointerup', finish);
		element.removeEventListener('pointercancel', cancel);
		element.removeEventListener('lostpointercapture', cancel);
		ownerWindow?.removeEventListener('blur', cancel);
		ownerWindow?.removeEventListener('keydown', onKey);
		if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
		cancelDrag = undefined;
	};
	const finish = () => { session.finish(); cleanup(); };
	const cancel = () => { session.cancel(); cleanup(); };
	const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } };
	cancelDrag = cancel;
	element.setPointerCapture(event.pointerId);
	element.addEventListener('pointermove', move);
	element.addEventListener('pointerup', finish);
	element.addEventListener('pointercancel', cancel);
	element.addEventListener('lostpointercapture', cancel);
	ownerWindow?.addEventListener('blur', cancel);
	ownerWindow?.addEventListener('keydown', onKey);
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
	top: 20px;
	height: 8px;
	background: color(from var(--LAYER_COLOR) srgb r g b / 0.4);
	pointer-events: none;
}

.key {
	position: absolute;
	top: 2px;
	transform: translateX(-6px);
	color: var(--LAYER_COLOR);
	white-space: nowrap;
	cursor: ew-resize;
	touch-action: none;
}

.key span {
	display: inline-block;
	max-width: 120px;
	overflow: hidden;
	text-overflow: ellipsis;
	font-size: 10px;
	vertical-align: middle;
	pointer-events: none;
}

</style>
