<template>
<GsFolder v-if="selectedClipEntry != null" defaultOpen asSection :withSpacer="false">
	<template #icon><i class="ti ti-ticket"></i></template>
	<template #label>{{ i18n.ts._TimelineClip.Title }}: {{ selectedClipLabel }}</template>
	<div style="margin-left: 16px; border-left: solid 1px #fff2;">
		<div class="_spacer _gaps_m">
			<GsInput type="number" :min="0" :modelValue="selectedClipEntry.clip.startMs" @update:modelValue="value => editSelectedClipTime('move', value)"><template #label>{{ i18n.ts.Start }}</template><template #suffix>ms</template></GsInput>
			<GsInput type="number" :min="0" :disabled="selectedClipNeedsMedia && !selectedClipMedia" :modelValue="selectedClipEntry.clip.startMs" @update:modelValue="value => editSelectedClipTime('start', value)"><template #label>{{ i18n.ts._TimelineClip.TrimStart }}</template><template #suffix>ms</template></GsInput>
			<GsInput data-test-clip-duration type="number" :min="1" :disabled="selectedClipNeedsMedia && !selectedClipMedia" :modelValue="selectedMediaClip ? getTimelineMediaSingleDuration(selectedMediaClip) : selectedClipEntry.clip.durationMs" @update:modelValue="value => editSelectedClipTime('duration', value)"><template #label>{{ selectedMediaClip ? i18n.ts._TimelineClip.TrimmedDuration : i18n.ts.Duration }}</template><template #suffix>ms</template></GsInput>
			<div v-if="'contentOffsetMs' in selectedClipEntry.clip">{{ i18n.ts._TimelineClip.ContentOffset }}: {{ formatMsToTimecode(selectedClipEntry.clip.contentOffsetMs) }}</div>
			<div v-if="selectedClipMedia">{{ i18n.ts._TimelineClip.SourceDuration }}: {{ formatMsToTimecode(selectedClipMedia.durationMs) }}</div>
			<template v-if="selectedMediaClip != null">
				<div>{{ i18n.ts._TimelineClip.SourceRange }}: {{ formatMsToTimecode(selectedMediaClip.sourceInMs) }} – {{ formatMsToTimecode(selectedMediaClip.sourceOutMs) }}</div>
				<GsInput data-test-clip-speed type="number" :min="timelineMediaMinPlaybackSpeed * 100" :max="timelineMediaMaxPlaybackSpeed * 100" :modelValue="speedPercent" @update:modelValue="value => speedPercent = Number(value)"><template #label>{{ i18n.ts._TimelineClip.Speed }}</template><template #suffix>%</template></GsInput>
				<GsSwitch v-model="reversePlayback" data-test-clip-reverse>{{ i18n.ts._TimelineClip.Reverse }}</GsSwitch>
				<div v-if="speedChange.timing">{{ i18n.ts._TimelineClip.DurationAtSpeed }}: {{ formatMsToTimecode(speedChange.timing.durationMs) }}</div>
				<div v-if="speedChange.error || speedError" data-test-clip-speed-error>{{ speedChange.error || speedError }}</div>
				<GsButton data-test-clip-apply-speed :disabled="!selectedClipMedia || !!speedChange.error || speedChange.timing?.playbackRate === selectedMediaClip.playbackRate" @click="editSelectedClipSpeed">{{ i18n.ts._TimelineClip.ApplySpeed }}</GsButton>
				<div>{{ i18n.ts._TimelineClip.SpeedHint }}</div>
				<GsInput data-test-clip-total-duration type="number" :min="getTimelineMediaSingleDuration(selectedMediaClip)" :disabled="!selectedClipMedia" :modelValue="selectedMediaClip.durationMs" @update:modelValue="editSelectedClipLoop"><template #label>{{ i18n.ts._TimelineClip.TotalDuration }}</template><template #suffix>ms</template></GsInput>
				<div>{{ i18n.ts._TimelineClip.LoopHint }}</div>
				<GsButton v-if="selectedMediaClip.loop" data-test-clip-remove-loop :disabled="!selectedClipMedia" @click="editSelectedClipLoop(getTimelineMediaSingleDuration(selectedMediaClip))">{{ i18n.ts._TimelineClip.RemoveLoop }}</GsButton>
			</template>
			<template v-if="selectedVideoClip != null">
				<GsButton v-if="!('sourceTimeMs' in selectedVideoClip)" data-test-clip-hold-frame :disabled="!canHoldCurrentFrame || holdingFrame" @click="holdCurrentFrame">{{ i18n.ts._TimelineClip.HoldCurrentFrame }}</GsButton>
				<template v-if="'sourceTimeMs' in selectedVideoClip">
					<GsInput data-test-clip-hold-source-time manualSave type="number" step="any" :min="0" :disabled="holdingFrame || selectedClipMedia == null" :modelValue="selectedVideoClip.sourceTimeMs" @update:modelValue="editHoldSourceTime"><template #label>{{ i18n.ts._TimelineClip.HoldSourceTime }}</template><template #suffix>ms</template></GsInput>
					<div>{{ i18n.ts._TimelineClip.HoldHint }}</div>
				</template>
				<div v-else>{{ i18n.ts._TimelineClip.SeekToHoldHint }}</div>
				<div v-if="holdError" data-test-clip-hold-error>{{ holdError }}</div>
				<GsSwitch data-test-clip-audio-enabled :modelValue="selectedVideoClip.audioEnabled" :disabled="'sourceTimeMs' in selectedVideoClip || (!selectedVideoClip.audioEnabled && !selectedClipMedia?.audioAvailable)" @update:modelValue="editSelectedClipAudio">{{ i18n.ts._TimelineClip.AudioEnabled }}</GsSwitch>
				<GsSwitch data-test-clip-audio-only :modelValue="!selectedVideoClip.videoEnabled" :disabled="'sourceTimeMs' in selectedVideoClip" @update:modelValue="editSelectedClipAudioOnly">{{ i18n.ts._TimelineClip.AudioOnly }}</GsSwitch>
				<div v-if="selectedClipMedia?.audioError">{{ selectedClipMedia.audioError }}</div>
			</template>
			<GsButton v-if="selectedClipEntry.layer.layerType === 'image' || selectedClipEntry.layer.layerType === 'video' || selectedClipEntry.layer.layerType === 'audio' || selectedClipEntry.layer.layerType === 'scene'" data-test-clip-change-source @click="emit('changeSource', selectedClipEntry.target)">{{ i18n.ts._TimelineClip.ChangeSource }}</GsButton>
			<GsButton v-if="selectedSceneClip != null" @click="activeSceneId = selectedSceneClip.sceneId">{{ i18n.ts._TimelineClip.OpenScene }}</GsButton>
			<GsButton data-test-clip-remove danger icon="ti ti-trash" @click="emit('remove')">{{ i18n.ts._TimelineClip.Remove }}</GsButton>
		</div>
	</div>
</GsFolder>
</template>

<script lang="ts" setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { changeTimelineMediaPlaybackRate, getTimelineMediaSourceTime, getTimelineMediaSingleDuration, timelineMediaMinPlaybackSpeed, timelineMediaMaxPlaybackSpeed } from '@gs/subsystems_timeline_shared/media-timing.ts';
import { isTimelineClipActive, validateTimelineClips } from '@gs/subsystems_timeline_shared/timing.ts';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import { shapeDefinitions } from '@gs/subsystems_timeline_shared/layers/shape/shape.ts';
import GsButton from './common/GsButton.vue';
import GsFolder from './common/GsFolder.vue';
import GsInput from './common/GsInput.vue';
import GsSwitch from './common/GsSwitch.vue';
import type { TimelineMediaClipTiming } from '@gs/subsystems_timeline_shared/media-timing.ts';
import type { TimelineClipLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineClipSelection } from '@/utility/timeline-selection.ts';
import type { TimelineClipMediaInfo } from '@/utility/timeline-clip-media.ts';
import { formatTimelineTimecode as formatMsToTimecode } from '@/utility/timeline-ticks.ts';
import { readTimelineVideoHoldFrame } from '@/utility/timeline-video-hold.ts';
import { appContext } from '@/app.ts';
import { i18n } from '@/i18n.ts';

const props = defineProps<{ sceneId: string; layer: TimelineClipLayer; clipId: string; mediaInfo: ReadonlyMap<string, TimelineClipMediaInfo> }>();
const emit = defineEmits<{ remove: []; changeSource: [target: TimelineClipSelection] }>();
const { activeSceneId } = appContext;
const { currentTimelineTime } = appContext.previewPlayback;
const { stateManager } = appContext.projectContext;
const selectedClipEntry = computed(() => {
	const layer = props.layer;
	const clip = layer.clips.find(clip => clip.id === props.clipId);
	return clip ? { layer, clip, target: { layerId: layer.id, clipId: clip.id } } : null;
});
const selectedClipNeedsMedia = computed(() => selectedClipEntry.value?.layer.layerType === 'audio' || selectedClipEntry.value?.layer.layerType === 'video');
const selectedClipMedia = computed(() => {
	const clip = selectedClipEntry.value?.clip;
	return clip && 'assetId' in clip && typeof clip.assetId === 'string' ? props.mediaInfo.get(clip.assetId) : null;
});
const selectedVideoClip = computed(() => {
	const entry = selectedClipEntry.value;
	return entry?.layer.layerType === 'video' ? entry.layer.clips.find(clip => clip.id === entry.clip.id) : null;
});
const selectedMediaClip = computed(() => {
	const clip = selectedClipEntry.value?.clip;
	return clip && 'sourceInMs' in clip ? clip : null;
});
const canHoldCurrentFrame = computed(() => selectedVideoClip.value != null && selectedVideoClip.value.videoEnabled && selectedClipMedia.value != null
	&& isTimelineClipActive(selectedVideoClip.value, currentTimelineTime.value));
const holdingFrame = ref(false);
const holdError = ref('');
let holdGeneration = 0;
watch(() => [props.sceneId, props.layer.id, props.clipId], () => {
	holdGeneration++;
	holdingFrame.value = false;
	holdError.value = '';
});
onUnmounted(() => { holdGeneration++; });
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
		if (!Number.isFinite(speedPercent.value) || speedPercent.value <= 0) throw new Error(i18n.ts._TimelineClip.InvalidSpeed);
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
	if ('assetId' in entry.clip) { const id = entry.clip.assetId; return stateManager.state.assets.value.find(asset => asset.id === id)?.name ?? i18n.ts._TimelineClip.MissingMedia; }
	if ('sceneId' in entry.clip) { const id = entry.clip.sceneId; return stateManager.state.timelineScenes.value.find(scene => scene.id === id)?.name ?? i18n.ts._TimelineClip.MissingScene; }
	if (entry.layer.layerType === 'visualModule') { const id = entry.layer.visualModuleId; return stateManager.state.visualModules.value.find(visualModule => visualModule.id === id)?.name ?? i18n.ts._TimelineClip.MissingVisualModule; }
	if (entry.layer.layerType === 'inlineVisualModule') return i18n.ts._TimelineClip.InlineVisualModule;
	if (entry.layer.layerType === 'effect') { const id = entry.layer.effectId; return Object.entries(effectDefinitions).find(([key, effect]) => key === id)?.[1].displayName ?? i18n.ts._TimelineClip.MissingEffect; }
	if (entry.layer.layerType === 'voicevox') return 'VOICEVOX';
	if (entry.layer.layerType === 'text') return i18n.ts.Text;
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
			sceneId: props.sceneId,
			...entry.target,
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
		sceneId: props.sceneId,
		layerId: props.layer.id,
		clipId: clip.id,
		deltaMs: next - clip.durationMs,
		sourceDurationMs: media.durationMs,
	});
}

function editSelectedClipSpeed() {
	const clip = selectedMediaClip.value;
	const media = selectedClipMedia.value;
	const timing = speedChange.value.timing;
	if (!clip || !media || !timing || speedChange.value.error) return;
	try {
		stateManager.commit('editMediaClipPlaybackRate', {
			sceneId: props.sceneId,
			layerId: props.layer.id,
			clipId: clip.id,
			playbackRate: timing.playbackRate,
			sourceDurationMs: media.durationMs,
		});
		speedError.value = '';
	} catch (error) { speedError.value = error instanceof Error ? error.message : String(error); }
}

function editSelectedClipAudio(audioEnabled: boolean) {
	const entry = selectedClipEntry.value;
	if (!entry || !selectedVideoClip.value) return;
	stateManager.commit('editVideoClipAudio', { sceneId: props.sceneId, ...entry.target, audioEnabled });
}

function editSelectedClipAudioOnly(audioOnly: boolean) {
	const entry = selectedClipEntry.value;
	const clip = selectedVideoClip.value;
	if (entry == null || clip == null || 'sourceTimeMs' in clip) return;
	stateManager.commit('editVideoClipVideoEnabled', { sceneId: props.sceneId, ...entry.target, videoEnabled: !audioOnly });
}

function holdCurrentFrame() {
	const clip = selectedVideoClip.value;
	if (clip == null || !canHoldCurrentFrame.value) return;
	const sourceTimeMs = 'sourceTimeMs' in clip ? clip.sourceTimeMs : getTimelineMediaSourceTime(clip, currentTimelineTime.value);
	void holdVideoFrame(sourceTimeMs, 'sourceInMs' in clip && clip.playbackRate < 0);
}

function editHoldSourceTime(value: string | number) {
	const clip = selectedVideoClip.value;
	if (clip == null || !('sourceTimeMs' in clip)) return;
	void holdVideoFrame(Number(value));
}

async function holdVideoFrame(sourceTimeMs: number, reversePlayback = false) {
	const entry = selectedClipEntry.value;
	const clip = selectedVideoClip.value;
	if (entry == null || clip == null || !clip.videoEnabled || holdingFrame.value) return;
	const asset = stateManager.state.assets.value.find(asset => asset.id === clip.assetId);
	if (asset == null) return;
	const fileSource = asset.fileData;
	const sceneId = props.sceneId;
	const scene = stateManager.state.timelineScenes.value.find(scene => scene.id === sceneId);
	const snapshot = JSON.stringify(clip);
	const generation = ++holdGeneration;
	holdingFrame.value = true;
	holdError.value = '';
	try {
		const frame = await readTimelineVideoHoldFrame(fileSource, sourceTimeMs, reversePlayback);
		// デコード待ちの間に選択・素材・プロジェクト・クリップ設定が変わったら適用しない。
		// 再生ヘッドだけの移動は許可し、ボタンを押した瞬間のフレームを保存する。
		if (generation !== holdGeneration || selectedVideoClip.value !== clip || JSON.stringify(clip) !== snapshot
			|| stateManager.state.timelineScenes.value.find(scene => scene.id === sceneId) !== scene
			|| !stateManager.state.assets.value.includes(asset) || asset.fileData !== fileSource) return;
		stateManager.commit('holdVideoClipFrame', { sceneId, ...entry.target, ...frame });
	} catch (error) {
		if (generation === holdGeneration) holdError.value = error instanceof Error ? error.message : String(error);
	} finally {
		if (generation === holdGeneration) holdingFrame.value = false;
	}
}
</script>
