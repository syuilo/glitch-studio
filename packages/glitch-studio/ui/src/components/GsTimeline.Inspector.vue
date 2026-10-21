<template>
<GsTimelineVoicevoxUtteranceSettings
	v-if="selectedUtterance != null" :key="'VoicevoxUtterance:'+ keyframeEditorKey" :sceneId="scene.id"
	:layer="selectedUtterance.layer" :utterance="selectedUtterance.utterance"
	@selected="keyframeId => emit('selectKeyframe', { layerId: selectedUtterance!.layer.id, target: 'utterance', paramPath: ['utterances'], keyframeId })"
/>
<GsFolder v-else-if="selection.kind === 'keyframes' && selection.keyframes.length > 1" defaultOpen asSection>
	<template #label>{{ i18n.tsx._TimelineKeyframe.SelectedCount({ count: selection.keyframes.length }) }}</template>
	<GsButton data-test-remove-keyframes danger icon="ti ti-trash" @click="emit('removeKeyframes')">{{ i18n.ts._TimelineKeyframe.RemoveMultiple }}</GsButton>
</GsFolder>
<GsTimelineInspectorKeyframe
	v-else-if="selectedLayer && selectedKeyframeSelection && selectedKeyframeSelection.target !== 'utterance'" :key="'Keyframe:'+ keyframeEditorKey"
	:sceneId="scene.id" :layer="selectedLayer" :selection="selectedKeyframeSelection"
	@remove="emit('removeKeyframes')"
/>
<GsTimelineInspectorClip
	v-else-if="selectedClipLayer && selectedClipSelection" :sceneId="scene.id" :layer="selectedClipLayer" :clipId="selectedClipSelection.clipId" :mediaInfo="mediaInfo"
	@remove="emit('removeClips')" @changeSource="emit('changeClipSource', $event)"
/>
<GsTimelineInspectorLayer
	v-else-if="selectedLayer" :key="JSON.stringify([scene.id, selectedLayer.id])" :scene="scene" :layer="selectedLayer"
	@selectKeyframe="emit('selectKeyframe', $event)" @requestAddInlineEffectNode="emit('requestAddInlineEffectNode', $event)"
	@expandRequested="emit('expandRequested', $event)"
	@revealAssets="emit('revealAssets')"
/>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.ts';
import { isTimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { computed } from 'vue';
import { flattenTimelineLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import GsButton from './common/GsButton.vue';
import GsFolder from './common/GsFolder.vue';
import GsTimelineInspectorKeyframe from './GsTimeline.Inspector.Keyframe.vue';
import GsTimelineInspectorClip from './GsTimeline.Inspector.Clip.vue';
import GsTimelineInspectorLayer from './GsTimeline.Inspector.Layer.vue';
import GsTimelineVoicevoxUtteranceSettings from './GsTimeline.VoicevoxUtteranceSettings.vue';
import type { TimelineClipMediaInfo } from '@/utility/timeline-clip-media.ts';
import type { TimelineClipSelection, TimelineKeyframeSelection, TimelineSelection } from '@/utility/timeline-selection.ts';
import type { TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import { getSelectedTimelineLayerId } from '@/utility/timeline-editor-state.ts';

const props = defineProps<{ scene: TimelineScene; selection: TimelineSelection; mediaInfo: ReadonlyMap<string, TimelineClipMediaInfo> }>();
const emit = defineEmits<{
	selectKeyframe: [selection: TimelineKeyframeSelection];
	expandRequested: [layerId: string];
	removeKeyframes: [];
	removeClips: [];
	changeClipSource: [target: TimelineClipSelection];
	requestAddInlineEffectNode: [layerId: string];
	revealAssets: [];
}>();

// 選択はタイムラインが所有し、詳細パネルでは表示対象の解決だけを行う。
// 非表示・再表示で選択を作り直さず、複数レイヤーにまたがる選択ではレイヤー詳細を出さない。
const sceneLayers = computed(() => flattenTimelineLayers(props.scene.layers));
const selectedLayer = computed(() => sceneLayers.value.find(layer => layer.id === getSelectedTimelineLayerId(props.selection)) ?? null);
const selectedKeyframeSelection = computed(() => props.selection.kind === 'keyframes' && props.selection.keyframes.length === 1 ? props.selection.keyframes[0] : null);
const keyframeEditorKey = computed(() => JSON.stringify(selectedKeyframeSelection.value));
const selectedUtterance = computed(() => {
	const point = selectedKeyframeSelection.value;
	if (point?.target !== 'utterance') return null;
	const layer = sceneLayers.value.find(layer => layer.id === point.layerId);
	if (layer?.layerType !== 'voicevox') return null;
	const utterance = layer.utterances.find(utterance => utterance.id === point.keyframeId);
	return utterance ? { layer, utterance } : null;
});

const selectedClipSelection = computed(() => props.selection.kind === 'clips' && props.selection.clips.length === 1 ? props.selection.clips[0] : null);
const selectedClipLayer = computed(() => selectedLayer.value && !isTimelineContainerLayer(selectedLayer.value) ? selectedLayer.value : null);
</script>
