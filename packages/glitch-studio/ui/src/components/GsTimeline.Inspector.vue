<template>
<GsTimelineVoicevoxUtteranceSettings
	v-if="selectedUtterance != null" :key="keyframeEditorKey" :sceneId="scene.id"
	:layer="selectedUtterance.layer" :utterance="selectedUtterance.utterance"
	@selected="keyframeId => emit('selectKeyframe', { layerId: selectedUtterance!.layer.id, target: 'utterance', paramPath: ['utterances'], keyframeId })"
/>
<GsFolder v-if="selection.kind === 'keyframes' && selection.keyframes.length > 1" defaultOpen asSection>
	<template #label>{{ selection.keyframes.length }} keyframes selected</template>
	<GsButton danger small @click="emit('removeKeyframes')"><i class="ti ti-trash"></i> Remove Keyframes</GsButton>
</GsFolder>
<GsTimelineInspectorKeyframe
	v-if="selectedLayer && selectedKeyframeSelection && selectedKeyframeSelection.target !== 'utterance'" :key="keyframeEditorKey"
	:sceneId="scene.id" :layer="selectedLayer" :selection="selectedKeyframeSelection"
	@remove="emit('removeKeyframes')"
/>
<GsTimelineInspectorClip
	v-if="selectedClipLayer && selectedClipSelection" :sceneId="scene.id" :layer="selectedClipLayer" :clipId="selectedClipSelection.clipId" :mediaInfo="mediaInfo"
	@remove="emit('removeClips')" @changeSource="emit('changeClipSource', $event)"
/>
<GsTimelineInspectorLayer
	v-if="selectedLayer" :scene="scene" :layer="selectedLayer"
	@selectKeyframe="emit('selectKeyframe', $event)" @requestAddInlineEffectNode="emit('requestAddInlineEffectNode', $event)"
/>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { flattenTimelineLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import type { TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineClipSelection, TimelineKeyframeSelection, TimelineSelection } from '@/utility/timeline-selection.ts';
import type { TimelineClipMediaInfo } from '@/utility/timeline-clip-media.ts';
import { getSelectedTimelineLayerId } from '@/utility/timeline-editor-state.ts';
import GsButton from './common/GsButton.vue';
import GsFolder from './common/GsFolder.vue';
import GsTimelineInspectorKeyframe from './GsTimeline.Inspector.Keyframe.vue';
import GsTimelineInspectorClip from './GsTimeline.Inspector.Clip.vue';
import GsTimelineInspectorLayer from './GsTimeline.Inspector.Layer.vue';
import GsTimelineVoicevoxUtteranceSettings from './GsTimeline.VoicevoxUtteranceSettings.vue';

const props = defineProps<{ scene: TimelineScene; selection: TimelineSelection; mediaInfo: ReadonlyMap<string, TimelineClipMediaInfo> }>();
const emit = defineEmits<{
	selectKeyframe: [selection: TimelineKeyframeSelection];
	removeKeyframes: [];
	removeClips: [];
	changeClipSource: [target: TimelineClipSelection];
	requestAddInlineEffectNode: [layerId: string];
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
const selectedClipLayer = computed(() => selectedLayer.value?.layerType !== 'group' ? selectedLayer.value : null);
</script>
