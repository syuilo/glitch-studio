<template>
<GsFolder v-if="selectedClipEntry != null" defaultOpen asSection :withSpacer="false">
	<template #icon><i class="ti ti-ticket"></i></template>
	<template #label>Clip: {{ selectedClipLabel }}</template>
	<div style="margin-left: 16px; border-left: solid 1px #fff2;">
		<div class="_spacer _gaps_m">
			<GsInput small type="number" :min="0" :modelValue="selectedClipEntry.clip.startMs" @update:modelValue="value => editSelectedClipTime('move', value)"><template #label>Start</template><template #suffix>ms</template></GsInput>
			<GsInput small type="number" :min="0" :disabled="selectedClipNeedsMedia && !selectedClipMedia" :modelValue="selectedClipEntry.clip.startMs" @update:modelValue="value => editSelectedClipTime('start', value)"><template #label>Trim start</template><template #suffix>ms</template></GsInput>
			<GsInput small type="number" :min="1" :disabled="selectedClipNeedsMedia && !selectedClipMedia" :modelValue="selectedMediaClip ? getTimelineMediaSingleDuration(selectedMediaClip) : selectedClipEntry.clip.durationMs" @update:modelValue="value => editSelectedClipTime('duration', value)"><template #label>{{ selectedMediaClip ? 'Trimmed duration' : 'Duration' }}</template><template #suffix>ms</template></GsInput>
			<div v-if="'contentOffsetMs' in selectedClipEntry.clip">Content offset: {{ formatMsToTimecode(selectedClipEntry.clip.contentOffsetMs) }}</div>
			<div v-if="selectedClipMedia">Source duration: {{ formatMsToTimecode(selectedClipMedia.durationMs) }}</div>
			<template v-if="selectedMediaClip != null">
				<div>Source range: {{ formatMsToTimecode(selectedMediaClip.sourceInMs) }} – {{ formatMsToTimecode(selectedMediaClip.sourceOutMs) }}</div>
				<GsInput small type="number" :min="timelineMediaMinPlaybackSpeed * 100" :max="timelineMediaMaxPlaybackSpeed * 100" :modelValue="speedPercent" @update:modelValue="value => speedPercent = Number(value)"><template #label>Speed</template><template #suffix>%</template></GsInput>
				<GsSwitch v-model="reversePlayback">Reverse playback</GsSwitch>
				<div v-if="speedChange.timing">Duration at this speed: {{ formatMsToTimecode(speedChange.timing.durationMs) }}</div>
				<div v-if="speedChange.error || speedError" role="alert">{{ speedChange.error || speedError }}</div>
				<GsButton small :disabled="!selectedClipMedia || !!speedChange.error || speedChange.timing?.playbackRate === selectedMediaClip.playbackRate" @click="editSelectedClipSpeed">Apply speed</GsButton>
				<div>Preserves the source range. Audio pitch follows the speed; reverse playback also reverses audio.</div>
				<GsInput small type="number" :min="getTimelineMediaSingleDuration(selectedMediaClip)" :disabled="!selectedClipMedia" :modelValue="selectedMediaClip.durationMs" @update:modelValue="editSelectedClipLoop"><template #label>Total duration</template><template #suffix>ms</template></GsInput>
				<div>Extend Total duration to repeat the trimmed range.</div>
				<GsButton v-if="selectedMediaClip.loop" small :disabled="!selectedClipMedia" @click="editSelectedClipLoop(getTimelineMediaSingleDuration(selectedMediaClip))">Remove loop</GsButton>
			</template>
			<template v-if="selectedVideoClip != null">
				<GsSwitch :modelValue="selectedVideoClip.audioEnabled" :disabled="!selectedVideoClip.audioEnabled && !selectedClipMedia?.audioAvailable" @update:modelValue="editSelectedClipAudio">Audio enabled</GsSwitch>
				<div v-if="selectedClipMedia?.audioError">{{ selectedClipMedia.audioError }}</div>
			</template>
			<GsButton v-if="selectedClipEntry.layer.layerType === 'image' || selectedClipEntry.layer.layerType === 'video' || selectedClipEntry.layer.layerType === 'audio' || selectedClipEntry.layer.layerType === 'scene'" small @click="emit('changeSource', selectedClipEntry.target)">Change source</GsButton>
			<GsButton v-if="selectedSceneClip != null" small @click="activeSceneId = selectedSceneClip.sceneId">Open scene</GsButton>
			<GsButton danger small @click="emit('remove')"><i class="ti ti-trash"></i> Remove Clip</GsButton>
		</div>
	</div>
</GsFolder>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { changeTimelineMediaPlaybackRate, getTimelineMediaSingleDuration, timelineMediaMinPlaybackSpeed, timelineMediaMaxPlaybackSpeed } from '@gs/subsystems_timeline_shared/media-timing.ts';
import { validateTimelineClips } from '@gs/subsystems_timeline_shared/timing.ts';
import type { TimelineMediaClipTiming } from '@gs/subsystems_timeline_shared/media-timing.ts';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import { shapeDefinitions } from '@gs/subsystems_timeline_shared/layers/shape/shape.ts';
import type { TimelineClipLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineClipSelection } from '@/utility/timeline-selection.ts';
import type { TimelineClipMediaInfo } from '@/utility/timeline-clip-media.ts';
import { formatTimelineTimecode as formatMsToTimecode } from '@/utility/timeline-ticks.ts';
import { appContext } from '@/app.ts';
import GsButton from './common/GsButton.vue';
import GsFolder from './common/GsFolder.vue';
import GsInput from './common/GsInput.vue';
import GsSwitch from './common/GsSwitch.vue';

const props = defineProps<{ sceneId: string; layer: TimelineClipLayer; clipId: string; mediaInfo: ReadonlyMap<string, TimelineClipMediaInfo> }>();
const emit = defineEmits<{ remove: []; changeSource: [target: TimelineClipSelection] }>();
const { activeSceneId } = appContext;
const { stateManager } = appContext.projectContext;
const selectedClipEntry = computed(() => {
	const layer = props.layer;
	const clip = layer.clips.find(clip => clip.id === props.clipId);
	return clip ? { layer, clip, target: { layerId: layer.id, clipId: clip.id } } : null;
});
const selectedClipNeedsMedia = computed(() => selectedClipEntry.value?.layer.layerType === 'audio' || selectedClipEntry.value?.layer.layerType === 'video');
const selectedClipMedia = computed(() => {
	const clip = selectedClipEntry.value?.clip;
	return clip && 'assetId' in clip && typeof clip.assetId === 'string' ? props.mediaInfo.get(clip.assetId) : undefined;
});
const selectedVideoClip = computed(() => {
	const entry = selectedClipEntry.value;
	return entry?.layer.layerType === 'video' ? entry.layer.clips.find(clip => clip.id === entry.clip.id) : null;
});
const selectedMediaClip = computed(() => {
	const clip = selectedClipEntry.value?.clip;
	return clip && 'sourceInMs' in clip ? clip : null;
});
const speedPercent = ref(100);
const reversePlayback = ref(false);
const speedError = ref('');
watch(() => [props.sceneId, props.layer.id, props.clipId, selectedMediaClip.value?.playbackRate], () => {
	speedPercent.value = Math.abs(selectedMediaClip.value?.playbackRate ?? 1) * 100;
	reversePlayback.value = (selectedMediaClip.value?.playbackRate ?? 1) < 0;
	speedError.value = '';
}, { immediate: true });
const speedChange = computed((): { timing: TimelineMediaClipTiming | null; error: string } => {
	const clip = selectedMediaClip.value;
	if (!clip) return { timing: null, error: '' };
	let timing: (typeof clip) | null = null;
	try {
		if (!Number.isFinite(speedPercent.value) || speedPercent.value <= 0) throw new Error('Speed must be greater than zero.');
		timing = changeTimelineMediaPlaybackRate(clip, speedPercent.value / 100 * (reversePlayback.value ? -1 : 1));
		validateTimelineClips(props.layer.clips.map(entry => entry.id === clip.id ? timing! : entry));
		return { timing, error: '' };
	} catch (error) { return { timing, error: error instanceof Error ? error.message : String(error) }; }
});
const selectedSceneClip = computed(() => {
	const entry = selectedClipEntry.value;
	return entry?.layer.layerType === 'scene' ? entry.layer.clips.find(clip => clip.id === entry.clip.id) : null;
});
const selectedClipLabel = computed(() => {
	const entry = selectedClipEntry.value;
	if (!entry) return '';
	if ('assetId' in entry.clip) { const id = entry.clip.assetId; return stateManager.state.assets.value.find(asset => asset.id === id)?.name ?? 'Missing media'; }
	if ('sceneId' in entry.clip) { const id = entry.clip.sceneId; return stateManager.state.timelineScenes.value.find(scene => scene.id === id)?.name ?? 'Missing scene'; }
	if (entry.layer.layerType === 'visualModule') { const id = entry.layer.visualModuleId; return stateManager.state.visualModules.value.find(visualModule => visualModule.id === id)?.name ?? 'Missing module'; }
	if (entry.layer.layerType === 'inlineVisualModule') return 'Inline Visual Module';
	if (entry.layer.layerType === 'effect') { const id = entry.layer.effectId; return Object.entries(effectDefinitions).find(([key, effect]) => key === id)?.[1].displayName ?? 'Missing effect'; }
	if (entry.layer.layerType === 'voicevox') return 'VOICEVOX';
	if (entry.layer.layerType === 'text') return 'Text';
	if (entry.layer.layerType === 'shape') return shapeDefinitions[entry.layer.shape.type].label;
	return '?';
});

function editSelectedClipTime(kind: 'move' | 'start' | 'duration', value: string | number) {
	const entry = selectedClipEntry.value;
	const next = Number(value);
	if (!entry || !Number.isFinite(next)) return;
	if (kind === 'move') stateManager.commit('moveTimelineClips', { sceneId: props.sceneId, clips: [entry.target], deltaMs: next - entry.clip.startMs });
	else {
		if (selectedClipNeedsMedia.value && !selectedClipMedia.value) return;
		stateManager.commit('editTimelineClipTiming', {
			sceneId: props.sceneId, ...entry.target,
			edge: kind === 'start' ? 'start' : 'end',
			deltaMs: kind === 'start' ? next - entry.clip.startMs : next - (selectedMediaClip.value ? getTimelineMediaSingleDuration(selectedMediaClip.value) : entry.clip.durationMs),
			sourceDurationMs: selectedClipMedia.value?.durationMs,
		});
	}
}

function editSelectedClipLoop(value: string | number) {
	const clip = selectedMediaClip.value;
	const media = selectedClipMedia.value;
	const next = Number(value);
	if (!clip || !media || !Number.isFinite(next)) return;
	stateManager.commit('editMediaClipLoop', {
		sceneId: props.sceneId, layerId: props.layer.id, clipId: clip.id,
		deltaMs: next - clip.durationMs, sourceDurationMs: media.durationMs,
	});
}

function editSelectedClipSpeed() {
	const clip = selectedMediaClip.value;
	const media = selectedClipMedia.value;
	const timing = speedChange.value.timing;
	if (!clip || !media || !timing || speedChange.value.error) return;
	try {
		stateManager.commit('editMediaClipPlaybackRate', { sceneId: props.sceneId, layerId: props.layer.id, clipId: clip.id, playbackRate: timing.playbackRate, sourceDurationMs: media.durationMs });
		speedError.value = '';
	} catch (error) { speedError.value = error instanceof Error ? error.message : String(error); }
}

function editSelectedClipAudio(audioEnabled: boolean) {
	const entry = selectedClipEntry.value;
	if (!entry || !selectedVideoClip.value) return;
	stateManager.commit('editVideoClipAudio', { sceneId: props.sceneId, ...entry.target, audioEnabled });
}
</script>
