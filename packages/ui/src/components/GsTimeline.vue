<template>
<div :class="$style.root" @keydown="onTlKeydown">
	<div :class="$style.header">
		<div :class="$style.headerLeft">
			<slot></slot>
		</div>
		<div :class="$style.headerCenter">
			<GsButton small :primary="previewPlayback.state.value.mode === 'timeline'" @click="previewPlayback.showTimeline()">Preview</GsButton>
			<GsButton v-if="previewPlayback.isTimelinePlaying.value" small primary @click="pause"><i class="ti ti-player-pause"></i></GsButton>
			<GsButton v-else small @click="play"><i class="ti ti-player-play"></i></GsButton>
			<span v-if="timelineAudioPreview.buffering.value">Buffering audio…</span>
			<span v-if="audioError || timelineAudioPreview.error.value || timelineRendererManagerController.errorMessage.value">{{ audioError || timelineAudioPreview.error.value || timelineRendererManagerController.errorMessage.value }}</span>
		</div>
		<div :class="$style.headerCenter">
			<span class="_monospace">{{ formatFullTimecode(time) }}</span>
		</div>
		<div :class="$style.headerRight">
			<GsButton small iconOnly><i class="ti ti-pointer"></i></GsButton>
			<GsButton small iconOnly><i class="ti ti-select-all"></i></GsButton>
			<GsButton small iconOnly><i class="ti ti-cut"></i></GsButton>
			<span>|</span>
			<GsButton small iconOnly><i class="ti ti-magnet"></i></GsButton>
		</div>
	</div>
	<div :class="[$style.body, { [$style.panning]: panning }]" @pointerdown.capture="onBackgroundPointerDown" @click.capture="onTimelineClick" @mousedown.capture="onPanMousedown" @auxclick.capture="onPanAuxclick">
		<div :class="$style.tlBgWrapper" data-timeline-surface>
			<div :class="$style.tlBgSideSpacer"></div>
			<div ref="tlEl" :class="$style.tlBg" tabindex="-1" @wheel="onTlWheel" @mousemove="onTlMousemove">
				<div :class="$style.ticksCorner"></div>
				<div :class="$style.tlRange" :style="{ width: tlRangeElWidth + 'px', left: tlRangeElPosX + 'px' }"></div>
				<div v-for="time of xTicks" :class="[$style.inTlXTick]" :style="{ left: timeToDomX(time) + 'px' }"></div>
			</div>
		</div>
		<div ref="layersEl" :class="$style.layers" data-timeline-surface>
			<div :class="$style.layersHeader">
				<GsButton v-tooltip="'Add Layer'" small iconOnly @click="showAddLayerMenu"><i class="ti ti-plus"></i></GsButton>
			</div>
			<GsDraggable
				:class="$style.layerList"
				:modelValue="sceneLayers"
				direction="vertical"
				manualDragStart
				style="--DRAGGABLE_MARGIN: 4px;"
				withGaps
				@update:modelValue="onLayersSorted"
			>
				<template #default="{ item: layer, dragStart }">
					<XLayer
						v-model:tlPosX="tlPosX"
						:layer="layer"
						:sceneId="sceneId"
						:tlElWidth="tlElWidth"
						:tlRangeX="tlRangeX"
						:timelineTicks="xTicks"
						:selectedKeyframes="selection.kind === 'keyframes' ? selection.keyframes : []"
						:class="$style.layersLane"
						:selected="selection.kind === 'layers' && selection.ids.includes(layer.id)"
						:moving="movingSelection && selection.kind === 'layers' && selection.ids.includes(layer.id)"
						@dragStart="dragStart"
						@selected="selectLayer(layer)"
						@moveStart="event => onLayerMoveStart(event, layer)"
						@keyframeDragStart="onKeyframeMoveStart"
						@keyframeSelected="onKeyframeSelected"
						@snap="snappingTimes = $event == null ? [] : [$event]"
					/>
				</template>
			</GsDraggable>
			<div>
				footer
			</div>
		</div>
		<div :class="$style.tlOverlayWrapper" data-timeline-surface>
			<div :class="$style.tlOverlaySideSpacer"></div>
			<div :class="$style.tlOverlay">
				<div :class="$style.xTicks" @wheel="onXTicksWheel">
					<div v-for="time of xTicks" :class="$style.xTick" class="_monospace" :style="{ left: timeToDomX(time) + 'px' }">{{ formatMsToTimecode(time) }}</div>
					<div :class="$style.xTicksSeekBar" :style="{ left: (seekBarPos - 1) + 'px' }" @mousedown="onSeekBarMousedown"></div>
				</div>
				<div :class="$style.ticksCorner"></div>
				<div v-if="selectionArea" :class="$style.selectedArea" :style="{ width: selectionArea.right - selectionArea.left + 'px', height: selectionArea.bottom - selectionArea.top + 'px', top: selectionArea.top + 'px', left: selectionArea.left + 'px' }"></div>
				<div v-for="time of xTicks" :class="[$style.inTlXTick]" :style="{ left: timeToDomX(time) + 'px' }"></div>
				<div :class="$style.seekBar" class="_monospace" :style="{ left: seekBarPos + 'px' }"><div :class="$style.seekBarFrame">{{ formatMsToTimecode(time) }}</div></div>
				<div :class="$style.cursorBar" :style="{ left: cursorBarPos + 'px' }"></div>
				<div v-for="snappingTime in snappingTimes" :key="snappingTime" :class="$style.snapLine" :style="{ left: timeToDomX(snappingTime) + 'px' }"></div>

				<!--
			<div v-if="(nowSelecting || selectedKeyframes.length === 0) && tooltipDomPos" :class="$style.tooltip" class="_monospace" :style="{ left: tooltipDomPos[0] + 'px', top: tooltipDomPos[1] + 'px' }">
				<div>T: {{ formatMsToTimecode(cursorTime) }}</div>
				<div>V: {{ cursorValue }}</div>
			</div>
			-->

				<!--

				<div :class="$style.infoBar" class="_monospace">
					<div><b>TL Offset</b>{{ tlPosX.toFixed(2) }}, {{ tlPosY.toFixed(2) }}</div>
					<div><b>Cursor</b>{{ cursorTime }}, {{ cursorValue }}</div>
				</div>
							-->
			</div>
		</div>

		<Teleport v-if="timelineSubPanelTeleportTargetAvailable" defer to="#timelineSubPanelTeleportTarget">
			<div v-if="selectionCount > 1" :class="$style.keyframeEditor">{{ selectionCount }} {{ selection.kind === 'layers' ? 'layers' : 'keyframes' }} selected</div>
			<div v-else-if="selectedKeyframe != null">
				<div :key="keyframeEditorKey" :class="$style.keyframeEditor">
					<GsButton small @click="selectedKeyframeSelection = null">Back to layer</GsButton>
					<div>{{ selectedKeyframe.def.ui.label }} · Keyframe</div>
					<GsInput small type="number" :min="selectedKeyframe.minX" :max="selectedKeyframe.maxX" :modelValue="selectedKeyframe.keyframe.x" @update:modelValue="updateKeyframeTime">
						<template #label>Time (ms)</template>
					</GsInput>
					<div>Value</div>
					<GsLiteralLeafValueControl
						:dataType="selectedKeyframe.binding.keyframesTimeline.dataType"
						:control="selectedKeyframe.def.ui.control"
						:value="selectedKeyframe.binding.keyframesTimeline.dataType.kind === 'scalar' ? selectedKeyframe.keyframe.value[0] : selectedKeyframe.keyframe.value.slice(0, selectedKeyframe.binding.keyframesTimeline.dataType.kind === 'vector' ? 2 : 4)"
						:title="selectedKeyframe.def.ui.label"
						@input="value => updateKeyframeValue(value)"
						@beginChanging="keyframeValueMergeKey = genId()"
						@changeContinuous="value => updateKeyframeValue(value, keyframeValueMergeKey)"
						@changeFinished="keyframeValueMergeKey = null"
						@reset="updateKeyframeValue(selectedKeyframe.def.defaultValue.value)"
					/>
					<GsSelect small :modelValue="selectedKeyframe.keyframe.interpolation.type" :items="[{ label: 'Hold', value: 'hold' }, { label: 'Linear', value: 'linear' }]" @update:modelValue="type => updateSelectedKeyframe({ interpolation: { type } })">
						<template #label>Interpolation to next keyframe</template>
					</GsSelect>
				</div>
			</div>
			<div v-else-if="selectedLayer?.layerType === 'audio'">
				<div>{{ appStateManager.state.assets.value.find(asset => asset.id === (selectedLayer?.layerType === 'audio' ? selectedLayer.assetId : ''))?.name ?? 'Missing audio' }}</div>
				<GsInput small type="number" :min="-selectedLayer.trimStartMs" :modelValue="selectedLayer.positionMs" @update:modelValue="value => editTrimmedLayerTiming('move', value)"><template #label>Position (ms)</template></GsInput>
				<GsInput small type="number" :min="Math.max(0, selectedLayer.positionMs)" :max="getTimelineLayerEnd(selectedLayer) - 1" :modelValue="getTimelineLayerStart(selectedLayer)" @update:modelValue="value => editTrimmedLayerTiming('trimStart', value)"><template #label>Trim start (ms)</template></GsInput>
				<GsInput small type="number" :min="getTimelineLayerStart(selectedLayer) + 1" :modelValue="getTimelineLayerEnd(selectedLayer)" @update:modelValue="value => editTrimmedLayerTiming('trimEnd', value)"><template #label>Trim end (ms)</template></GsInput>
				<GsInput small type="number" :min="0" :modelValue="selectedLayer.trimStartMs" @update:modelValue="value => editTrimmedLayerTiming('offset', value)"><template #label>Source offset (ms)</template></GsInput>
				<GsVisualParam
					:key="selectedLayer.id"
					:availableVariables="AUDIO_LAYER_VAR_DEFS"
					:automationGraphs="selectedLayer.automationGraphs"
					:paramPath="['volume']"
					:paramDef="timelineAudioParamDefs.volume"
					:paramValue="selectedLayer.paramValues.volume"
					@edit="event => onVisualModuleLayerParamEdit(event, 'audio')"
				/>
				<GsButton danger @click="appStateManager.commit('removeTimelineLayer', { sceneId: props.sceneId, layerId: selectedLayer.id })">Remove Layer</GsButton>
			</div>
			<div v-else-if="selectedLayer?.layerType === 'video'">
				<div>{{ appStateManager.state.assets.value.find(asset => asset.id === (selectedLayer?.layerType === 'video' ? selectedLayer.assetId : ''))?.name ?? 'Missing video' }}</div>
				<GsInput small type="number" :min="-selectedLayer.trimStartMs" :modelValue="selectedLayer.positionMs" @update:modelValue="value => editTrimmedLayerTiming('move', value)"><template #label>Position (ms)</template></GsInput>
				<GsInput small type="number" :min="Math.max(0, selectedLayer.positionMs)" :max="getTimelineLayerEnd(selectedLayer) - 1" :modelValue="getTimelineLayerStart(selectedLayer)" @update:modelValue="value => editTrimmedLayerTiming('trimStart', value)"><template #label>Trim start (ms)</template></GsInput>
				<GsInput small type="number" :min="getTimelineLayerStart(selectedLayer) + 1" :max="selectedVideoMetadata ? selectedLayer.positionMs + selectedVideoMetadata.durationMs : undefined" :modelValue="getTimelineLayerEnd(selectedLayer)" @update:modelValue="value => editTrimmedLayerTiming('trimEnd', value)"><template #label>Trim end (ms)</template></GsInput>
				<GsInput small type="number" :min="0" :max="selectedVideoMetadata ? selectedVideoMetadata.durationMs - selectedLayer.trimmedDurationMs : undefined" :modelValue="selectedLayer.trimStartMs" @update:modelValue="value => editTrimmedLayerTiming('offset', value)"><template #label>Source offset (ms)</template></GsInput>
				<div v-if="selectedVideoMetadata">Source duration: {{ formatMsToTimecode(selectedVideoMetadata.durationMs) }}</div>
				<GsSelect
					small :modelValue="selectedLayer.fitMode" :items="[{ label: 'Contain', value: 'contain' }, { label: 'Cover', value: 'cover' }, { label: 'Stretch', value: 'stretch' }]"
					@update:modelValue="fitMode => appStateManager.commit('editVideoLayerSettings', { sceneId: props.sceneId, layerId: selectedLayer!.id, fitMode })"
				>
					<template #label>Fit</template>
				</GsSelect>
				<div>Compositing</div>
				<GsVisualParam
					v-for="(paramDef, paramId) in timelineCompositingParamDefs" :key="selectedLayer.id + ':' + paramId"
					:availableVariables="LAYER_VAR_DEFS" :automationGraphs="selectedLayer.automationGraphs" :paramPath="[paramId]" :paramDef="paramDef"
					:paramValue="selectedLayer.compositingParamValues[paramId]" @edit="event => onVisualModuleLayerParamEdit(event, 'compositing')"
				/>
				<GsSwitch
					:modelValue="selectedLayer.audioEnabled" :disabled="!selectedLayer.audioEnabled && (!selectedVideoMetadata?.audio || !!selectedVideoAudioError)"
					@update:modelValue="audioEnabled => appStateManager.commit('editVideoLayerSettings', { sceneId: props.sceneId, layerId: selectedLayer!.id, audioEnabled })"
				>
					Audio enabled
				</GsSwitch>
				<div v-if="selectedVideoAudioError">{{ selectedVideoAudioError }}</div>
				<div v-else-if="selectedVideoMetadata && !selectedVideoMetadata.audio">No audio track</div>
				<GsVisualParam
					:key="selectedLayer.id"
					:availableVariables="AUDIO_LAYER_VAR_DEFS"
					:automationGraphs="selectedLayer.automationGraphs"
					:paramPath="['volume']"
					:paramDef="timelineAudioParamDefs.volume"
					:paramValue="selectedLayer.audioParamValues.volume"
					@edit="event => onVisualModuleLayerParamEdit(event, 'audio')"
				/>
				<GsButton danger @click="appStateManager.commit('removeTimelineLayer', { sceneId: props.sceneId, layerId: selectedLayer.id })">Remove Layer</GsButton>
			</div>
			<div v-else-if="selectedLayer?.layerType === 'scene'" :class="$style.layerSettings">
				<div>{{ appStateManager.state.timelineScenes.value.find(scene => scene.id === (selectedLayer?.layerType === 'scene' ? selectedLayer.sceneId : ''))?.name }}</div>
				<GsButton small @click="activeSceneId = selectedLayer.sceneId">Open scene</GsButton>
				<GsInput small type="number" :min="-selectedLayer.trimStartMs" :modelValue="selectedLayer.positionMs" @update:modelValue="value => editTrimmedLayerTiming('move', value)"><template #label>Position (ms)</template></GsInput>
				<GsInput small type="number" :min="Math.max(0, selectedLayer.positionMs)" :max="getTimelineLayerEnd(selectedLayer) - 1" :modelValue="getTimelineLayerStart(selectedLayer)" @update:modelValue="value => editTrimmedLayerTiming('trimStart', value)"><template #label>Trim start (ms)</template></GsInput>
				<GsInput small type="number" :min="getTimelineLayerStart(selectedLayer) + 1" :modelValue="getTimelineLayerEnd(selectedLayer)" @update:modelValue="value => editTrimmedLayerTiming('trimEnd', value)"><template #label>Trim end (ms)</template></GsInput>
				<GsInput small type="number" :min="0" :modelValue="selectedLayer.trimStartMs" @update:modelValue="value => editTrimmedLayerTiming('offset', value)"><template #label>Source offset (ms)</template></GsInput>
				<div>Compositing</div>
				<GsVisualParam
					v-for="(paramDef, paramId) in timelineCompositingParamDefs" :key="selectedLayer.id + ':' + paramId"
					:availableVariables="LAYER_VAR_DEFS" :automationGraphs="selectedLayer.automationGraphs" :paramPath="[paramId]" :paramDef="paramDef"
					:paramValue="selectedLayer.compositingParamValues[paramId]" @edit="event => onVisualModuleLayerParamEdit(event, 'compositing')"
				/>
				<div>Audio</div>
				<GsVisualParam
					:key="selectedLayer.id + ':volume'" :availableVariables="LAYER_VAR_DEFS" :automationGraphs="selectedLayer.automationGraphs"
					:paramPath="['volume']" :paramDef="timelineAudioParamDefs.volume" :paramValue="selectedLayer.audioParamValues.volume" @edit="event => onVisualModuleLayerParamEdit(event, 'audio')"
				/>
				<GsButton danger @click="appStateManager.commit('removeTimelineLayer', { sceneId: props.sceneId, layerId: selectedLayer.id })">Remove Layer</GsButton>
			</div>
			<div v-else-if="selectedLayer?.layerType === 'visualModule' || selectedLayer?.layerType === 'inlineVisualModule'">
				<GsTabs v-if="selectedLayer.layerType === 'inlineVisualModule'" v-model="visualModuleLayerTab" :def="[{ id: 'settings', label: 'Layer settings' }, { id: 'module', label: 'Visual Module' }]"/>
				<GsVisualModuleEditor
					v-if="selectedLayer.layerType === 'inlineVisualModule' && visualModuleLayerTab === 'module'"
					:key="selectedLayer.id"
					:class="$style.inlineModuleEditor"
					:visualModule="selectedLayer.visualModule"
					:effectStates="inlineEffectStates"
					@edit="onInlineVisualModuleEdit"
					@requestAddNode="showAddInlineNodeMenu"
				/>
				<div v-else :class="$style.layerSettings">
					<div>{{ selectedLayer.layerType === 'visualModule' ? appStateManager.getVisualModuleById(selectedLayer.visualModuleId)?.name : 'Inline Visual Module' }}</div>
					<GsInput small type="number" :min="0" :modelValue="selectedLayer.positionMs" @update:modelValue="value => editVisualModuleTiming('position', value)"><template #label>Position (ms)</template></GsInput>
					<GsInput small type="number" :min="1" :modelValue="selectedLayer.trimmedDurationMs" @update:modelValue="value => editVisualModuleTiming('duration', value)"><template #label>Duration (ms)</template></GsInput>
					<div>Compositing</div>
					<GsVisualParam
						v-for="(paramDef, paramId) in timelineCompositingParamDefs"
						:key="`${selectedLayer.id}:compositing:${paramId}`"
						:availableVariables="LAYER_VAR_DEFS"
						:automationGraphs="selectedLayer.automationGraphs"
						:paramPath="[paramId]"
						:paramDef="paramDef"
						:paramValue="selectedLayer.compositingParamValues[paramId]"
						@edit="event => onVisualModuleLayerParamEdit(event, 'compositing')"
					/>
					<div>Module parameters</div>
					<!-- TODO: struct / array / anyのカスタムパラメータ編集UI。型定義では許可するが、子の編集や配列操作は未対応。 -->
					<template
						v-for="paramDef of selectedLayerModule?.paramDefs.filter(paramDef => paramDef.id !== selectedLayerModule?.primaryInputId) ?? []"
						:key="`${selectedLayer.id}:${paramDef.id}`"
					>
						<div v-if="paramDef.dataType.kind === 'struct' || paramDef.dataType.kind === 'array' || isParameterType(paramDef, 'any')">{{ paramDef.ui.label }}: Editing is not yet supported.</div>
						<GsVisualParam
							v-else
							:availableVariables="LAYER_VAR_DEFS"
							:automationGraphs="selectedLayer.automationGraphs"
							:paramPath="[paramDef.id]"
							:paramDef="{ ...paramDef, canNode: false }"
							:paramValue="selectedLayer.paramValues[paramDef.id] ?? paramDef.defaultValue"
							@edit="event => onVisualModuleLayerParamEdit(event, 'module')"
						/>
					</template>
					<GsButton danger @click="appStateManager.commit('removeTimelineLayer', { sceneId: props.sceneId, layerId: selectedLayer.id })">Remove Layer</GsButton>
				</div>
			</div>
		</Teleport>
		<div v-else :class="$style.rightSidePanel">
			<!-- TODO -->
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { getTimelineLayerStart, getTimelineLayerEnd } from '@glitch/shared/timeline/timing.ts';
import { isParameterType } from '@glitch/shared/parameter.ts';
import { LAYER_VAR_DEFS } from '@glitch/shared/expression.ts';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { insertIntermediateNumbers, nearlyEqual, niceScale } from '@glitch/shared/utility/misc.js';
import { genId } from '@glitch/shared/utility/id.js';
import { timelineAudioParamDefs, AUDIO_LAYER_VAR_DEFS } from '@glitch/shared/timeline/timeline-audio.ts';
import { timelineCompositingParamDefs } from '@glitch/shared/timeline/timeline-compositing.ts';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { getSceneDuration, canReferenceScene } from '@glitch/shared/timeline/scenes.ts';
import XLayer from './GsTimeline.Layer.vue';
import GsLiteralLeafValueControl from './GsLiteralLeafValueControl.vue';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import GsSwitch from './common/GsSwitch.vue';
import GsButton from './common/GsButton.vue';
import GsDraggable from './common/GsDraggable.vue';
import GsVisualParam from './GsVisualParam.vue';
import GsVisualModuleEditor from './GsVisualModuleEditor.vue';
import GsEffectPicker from './GsEffectPicker.vue';
import GsTabs from './common/GsTabs.vue';
import type { MediaMetadata } from '@glitch/shared/media/media-metadata.ts';
import type { Asset } from '@glitch/shared/types.ts';
import type { VisualModuleEdit } from '@/types/visual-module-editor.ts';
import type { TimelineLayer, TimelineVideoLayer } from '@glitch/shared/timeline/types.ts';
import type { ParameterBinding, KeyframesTimelineKeyframe } from '@glitch/shared/types.ts';
import type { TimelineKeyframeSelection, TimelineSelection, TimelineSelectionGeometry, SelectionRect, TimelineMovePoint } from '@/utility/timeline-selection.ts';
import { timelineMarqueeRect, selectTimelineRange, keyframeSelectionKey, constrainTimelineMove, keyframeMoveBounds } from '@/utility/timeline-selection.ts';
import { listenPointerDrag } from '@/utility/pointer-drag.ts';
import type { ParamEdit } from './GsVisualParam.vue';
import { getLayerParameterValues } from '@/utility/timeline-scene.ts';
import { inspectVideoLayerAsset } from '@/utility/video-layer-asset.ts';
import { sceneEditorStates, timelineLayerClipboard } from '@/utility/timeline-editor-state.ts';
import * as ui from '@/ui.ts';
import { createInlineVisualModuleLayer } from '@/utility/inline-visual-module-layer.ts';
import { commitVisualModuleEdit } from '@/utility/visual-module-edit.ts';
import * as api from '@/api.ts';
import { openAssetAudio } from '@/audio/asset-audio-reader.ts';
import { appStateManager, activeSceneId, previewPlayback, timelineAudioPreview, timelineRendererManagerController, timelineSubPanelTeleportTargetAvailable } from '@/app.ts';
import { dragListen } from '@/utility/drag.ts';

const props = defineProps<{ sceneId: string }>();
const editedScene = appStateManager.state.timelineScenes.value.find(scene => scene.id === props.sceneId)!;
const editorState = sceneEditorStates.get(editedScene);
let disposed = false;
const sceneLayers = computed(() => appStateManager.state.timelineScenes.value.find(scene => scene.id === props.sceneId)?.layers ?? []);
const availableScenes = computed(() => appStateManager.state.timelineScenes.value.filter(scene => getSceneDuration(scene) > 0 && canReferenceScene(appStateManager.state.timelineScenes.value, props.sceneId, scene.id)));
const sceneToAdd = ref('');
const sceneLayerItems = computed(() => [{ label: 'Choose scene to add', value: '' }, ...availableScenes.value.map(scene => ({ label: scene.name, value: scene.id }))]);

const X_TICKS_HEIGHT = 20;
const Y_TICKS_WIDTH = 0;

function onLayersSorted(layers: TimelineLayer[]) {
	const layerIds = layers.map(layer => layer.id);
	if (layerIds.length === sceneLayers.value.length && layerIds.every((id, index) => id === sceneLayers.value[index]?.id)) return;
	appStateManager.commit('reorderTimelineLayers', { sceneId: props.sceneId, layerIds });
}

const duration = computed(() => {
	return sceneLayers.value.reduce((max, layer) => Math.max(max, getTimelineLayerEnd(layer)), 0) ?? 0;
});
const time = previewPlayback.currentTimelineTime;

const tlEl = useTemplateRef('tlEl');
const layersEl = useTemplateRef('layersEl');
const panning = ref(false);
const tlElWidth = ref(0);
const tlElHeight = ref(0);
const tlRangeX = ref(editorState?.rangeX ?? 30000);
const tlRangeY = ref(5);
const tlPosX = ref(editorState?.positionX ?? -3000);
const tlPosY = ref(-2.5);
const snappingY = ref<number | null>(null);
const seekBarPos = computed(() => {
	return timeToDomX(time.value);
});
const cursorBarPos = ref(0);
const snappingTimes = ref<number[]>([]);
const tlRangeElPosX = computed(() => {
	return -((tlPosX.value / tlRangeX.value) * tlElWidth.value);
});
const tlRangeElWidth = computed(() => {
	return (duration.value / tlRangeX.value) * tlElWidth.value;
});
const tooltipDomPos = ref<null | [number, number]>(null);
const cursorTime = ref(0);
const cursorValue = ref(0);
const selectionArea = ref<SelectionRect | null>(null);
const movingSelection = ref(false);

const selection = ref<TimelineSelection>({ kind: 'layers', ids: editorState?.selectedLayerId ? [editorState.selectedLayerId] : [] });
const selectionCount = computed(() => selection.value.kind === 'layers' ? selection.value.ids.length : selection.value.keyframes.length);
const selectedLayerId = computed(() => selection.value.kind === 'layers' ? selection.value.ids[0] ?? null : selection.value.keyframes[0]?.layerId ?? null);
const selectedLayer = computed(() => selectionCount.value > 1 ? null : sceneLayers.value.find(layer => layer.id === selectedLayerId.value) ?? null);
const visualModuleLayerTab = ref('settings');
const selectedLayerModule = computed(() => {
	const layer = selectedLayer.value;
	return layer?.layerType === 'inlineVisualModule' ? layer.visualModule
		: layer?.layerType === 'visualModule' ? appStateManager.getVisualModuleById(layer.visualModuleId) : null;
});
const inlineEffectStates = computed(() => previewPlayback.state.value.mode === 'timeline' && selectedLayer.value != null
	? timelineRendererManagerController.getLayerEffectStates(props.sceneId, selectedLayer.value.id) : undefined);

const selectedKeyframeSelection = computed<TimelineKeyframeSelection | null>({
	get: () => selection.value.kind === 'keyframes' && selection.value.keyframes.length === 1 ? selection.value.keyframes[0] : null,
	set: point => { selection.value = point ? { kind: 'keyframes', keyframes: [point] } : { kind: 'layers', ids: selectedLayerId.value ? [selectedLayerId.value] : [] }; },
});
const keyframeValueMergeKey = ref<string | null>(null);
const keyframeEditorKey = computed(() => JSON.stringify(selectedKeyframeSelection.value));
const selectedKeyframe = computed(() => {
	const selection = selectedKeyframeSelection.value;
	if (selection == null) return null;
	const layer = sceneLayers.value.find(entry => entry.id === selection.layerId);
	if (layer == null || layer.layerType === 'effect') return null;
	const values: Partial<Record<string, ParameterBinding>> = getLayerParameterValues(layer, selection.target);
	const binding = values[selection.paramId];
	if (binding?.inputSource !== 'keyframesTimelineInline') return null;
	const def = selection.target === 'audio' ? timelineAudioParamDefs.volume : selection.target === 'compositing'
		? Object.entries(timelineCompositingParamDefs).find(([id]) => id === selection.paramId)?.[1]
		: (layer.layerType === 'inlineVisualModule' ? layer.visualModule : layer.layerType === 'visualModule' ? appStateManager.getVisualModuleById(layer.visualModuleId) : null)?.paramDefs.find(entry => entry.id === selection.paramId);
	if (def == null || !(isParameterType(def, 'scalar') || isParameterType(def, 'vector') || isParameterType(def, 'color')) || def.dataType.kind !== binding.keyframesTimeline.dataType.kind) return null;
	const keyframes = binding.keyframesTimeline.keyframes.toSorted((a, b) => a.x - b.x);
	const index = keyframes.findIndex(entry => entry.id === selection.keyframeId);
	if (index < 0) return null;
	return {
		selection, binding, def, keyframe: keyframes[index],
		minX: Math.max(0, keyframes[index - 1]?.x ?? -Infinity),
		maxX: keyframes[index + 1]?.x ?? Infinity,
	};
});

watch(selectedKeyframeSelection, () => { keyframeValueMergeKey.value = null; });
watch(selectedKeyframe, value => {
	if (value == null && selectedKeyframeSelection.value != null) selectedKeyframeSelection.value = null;
});

function onKeyframeSelected(selection: TimelineKeyframeSelection) {
	selectedKeyframeSelection.value = selection;
}

function updateSelectedKeyframe(patch: Partial<Pick<KeyframesTimelineKeyframe, 'x' | 'value' | 'interpolation'>>, mergeKey?: string | null) {
	const selected = selectedKeyframe.value;
	if (selected == null) return;
	if (Object.entries(patch).every(([key, value]) => JSON.stringify(selected.keyframe[key as keyof KeyframesTimelineKeyframe]) === JSON.stringify(value))) return;
	const value = deepClone(selected.binding);
	const keyframe = value.keyframesTimeline.keyframes.find(entry => entry.id === selected.selection.keyframeId);
	if (keyframe == null) return;
	Object.assign(keyframe, deepClone(patch));
	appStateManager.commit('editTimelineLayerParam', { sceneId: props.sceneId,
																																																				layerId: selected.selection.layerId, target: selected.selection.target,
																																																				paramId: selected.selection.paramId,
																																																				edit: { kind: 'keyframesTimelineInline', value },
	}, mergeKey);
}

function updateKeyframeValue(value: unknown, mergeKey?: string | null) {
	const selected = selectedKeyframe.value;
	if (selected == null) return;
	const kind = selected.binding.keyframesTimeline.dataType.kind;
	if (typeof value !== 'number' && !Array.isArray(value)) return;
	const components = typeof value === 'number' ? [value] : [...value];
	if (components.length !== (kind === 'scalar' ? 1 : kind === 'vector' ? 2 : 4) || !components.every(Number.isFinite)) return;
	updateSelectedKeyframe({ value: components }, mergeKey);
}

function updateKeyframeTime(value: string | number) {
	const selected = selectedKeyframe.value;
	const x = Number(value);
	if (selected == null || !Number.isFinite(x)) return;
	updateSelectedKeyframe({ x: Math.max(selected.minX, Math.min(selected.maxX, x)) });
}

// TODO: TLの表示DOMサイズに応じて変更
const xTicksCount = ref(15);
const xTicks = computed(() => niceScale(tlPosX.value, tlPosX.value + tlRangeX.value, xTicksCount.value));
const xTicksWithHalf = computed(() => insertIntermediateNumbers(xTicks.value));
const yTicksCount = ref(6);
const yTicks = computed(() => niceScale(tlPosY.value, tlPosY.value + tlRangeY.value, yTicksCount.value));
const yTicksWithHalf = computed(() => insertIntermediateNumbers(yTicks.value));

function timeToDomX(time: number): number {
	return ((time - tlPosX.value) / tlRangeX.value) * tlElWidth.value;
}

function valueToDomY(value: number): number {
	return tlElHeight.value - (((value - tlPosY.value) / tlRangeY.value) * tlElHeight.value);
}

function logicalXToDomX(x: number): number {
	return timeToDomX(x);
}

function logicalYToDomY(y: number): number {
	return valueToDomY(y);
}

function domXToLogicalX(x: number): number {
	return ((x / tlElWidth.value) * tlRangeX.value);
}

function domXToTime(x: number): number {
	return Math.round(domXToLogicalX(x) + tlPosX.value);
}

function domYToLogicalY(y: number): number {
	return ((1 - (y / tlElHeight.value)) * tlRangeY.value);
}

function domYToValue(y: number): number {
	return domYToLogicalY(y) + tlPosY.value;
}

function onTlMousemove(ev: MouseEvent) {
	if (tlEl.value == null) return;
	const rect = tlEl.value.getBoundingClientRect();
	const mouseX = ev.clientX - rect.left;
	const mouseY = ev.clientY - rect.top;
	const time = domXToTime(mouseX);
	cursorBarPos.value = timeToDomX(time);

	cursorTime.value = time;
	tooltipDomPos.value = [mouseX + 10, mouseY + 10];
}

function onTlWheel(ev: WheelEvent) {
	if (tlEl.value == null) return;
	ev.preventDefault();

	const rect = tlEl.value.getBoundingClientRect();
	const x = ev.clientX - rect.left;
	const y = ev.clientY - rect.top;
	const anchorTime = domXToLogicalX(x) + tlPosX.value;
	const anchorValue = domYToValue(y);

	tlRangeX.value *= 1 + (ev.deltaY / 1000);
	tlRangeY.value *= 1 + (ev.deltaY / 1000);

	// 拡大・縮小前にカーソル直下にあった時刻・値が、同じ画面位置に留まるように補正する。
	tlPosX.value = anchorTime - domXToLogicalX(x);
	tlPosY.value = anchorValue - domYToLogicalY(y);
}

function onXTicksWheel(ev: WheelEvent) {
	if (tlEl.value == null) return;
	ev.preventDefault();
	ev.stopPropagation();

	const rect = tlEl.value.getBoundingClientRect();
	const x = ev.clientX - rect.left;
	const anchorTime = domXToLogicalX(x) + tlPosX.value;

	tlRangeX.value *= 1 + (ev.deltaY / 1000);
	tlPosX.value = anchorTime - domXToLogicalX(x);
}

let stopPan: (() => void) | undefined;

function onPanAuxclick(ev: MouseEvent) {
	if (ev.button !== 1 || !(ev.target instanceof Element) || !ev.target.closest('[data-timeline-surface]')) return;
	ev.preventDefault();
	ev.stopPropagation();
}

function onPanMousedown(ev: MouseEvent) {
	if (stopSelectionDrag != null) return;
	if (ev.button !== 1 || !(ev.target instanceof Element) || !ev.target.closest('[data-timeline-surface]')) return;
	if (layersEl.value == null || tlElWidth.value <= 0) return;
	// 子のレイヤー・キー・シーク操作より先に受け取り、ブラウザーの自動スクロールも抑止する。
	ev.preventDefault();
	ev.stopPropagation();
	stopPan?.();
	tlEl.value?.focus({ preventScroll: true });
	const layers = layersEl.value;
	const baseX = ev.clientX;
	const baseY = ev.clientY;
	const baseTime = tlPosX.value;
	const baseScrollTop = layers.scrollTop;
	const msPerPixel = tlRangeX.value / tlElWidth.value;
	panning.value = true;
	stopPan = dragListen(event => {
		if ((event.buttons & 4) === 0) { stopPan?.(); return; }
		tlPosX.value = baseTime - (event.clientX - baseX) * msPerPixel;
		// 縦方向は値の座標系ではなく、レイヤー一覧の実際のスクロール位置を動かす。
		layers.scrollTop = baseScrollTop - (event.clientY - baseY);
	}, () => {
		panning.value = false;
		stopPan = undefined;
		window.removeEventListener('blur', finishPan);
	});
	window.addEventListener('blur', finishPan);
}

function finishPan() {
	stopPan?.();
}

onBeforeUnmount(finishPan);

const keyframeEntries = computed(() => sceneLayers.value.flatMap(layer => {
	const targets = layer.layerType === 'audio' ? ['audio'] as const
		: layer.layerType === 'scene' || layer.layerType === 'video' ? ['compositing', 'audio'] as const : ['compositing', 'module'] as const;
	return targets.flatMap(target => Object.entries(getLayerParameterValues(layer, target)).flatMap(([paramId, binding]) => {
		if (binding.inputSource !== 'keyframesTimelineInline') return [];
		return binding.keyframesTimeline.keyframes.map(point => ({
			selection: { layerId: layer.id, target, paramId, keyframeId: point.id },
			x: point.x, time: layer.positionMs + point.x, keyframes: binding.keyframesTimeline.keyframes,
		}));
	}));
}));

watch([sceneLayers, keyframeEntries], () => {
	const current = selection.value;
	if (current.kind === 'layers') {
		const ids = current.ids.filter(id => sceneLayers.value.some(layer => layer.id === id));
		if (ids.length !== current.ids.length) selection.value = { kind: 'layers', ids };
	} else {
		const available = new Set(keyframeEntries.value.map(entry => keyframeSelectionKey(entry.selection)));
		const keyframes = current.keyframes.filter(point => available.has(keyframeSelectionKey(point)));
		if (keyframes.length !== current.keyframes.length) selection.value = { kind: 'keyframes', keyframes };
	}
});

let stopSelectionDrag: (() => void) | undefined;
let suppressTimelineClick = false;

function onTimelineClick(event: MouseEvent) {
	if (!suppressTimelineClick) return;
	suppressTimelineClick = false;
	event.preventDefault();
	event.stopPropagation();
}

function readSelectionGeometry(viewport: SelectionRect): TimelineSelectionGeometry {
	const geometry: TimelineSelectionGeometry = { clips: [], keyframes: [] };
	if (layersEl.value == null) return geometry;
	// DOMへの依存は計測だけに限定する。CSSクラスや子要素の順序で対象を識別しない。
	for (const element of layersEl.value.querySelectorAll<HTMLElement>('[data-timeline-clip]')) {
		const id = element.closest<HTMLElement>('[data-timeline-layer-id]')?.dataset.timelineLayerId;
		const rect = element.getBoundingClientRect();
		// 横方向のサイドバーに隠れる部分だけ除く。縦方向は、スクロールで画面外へ出た行も判定する。
		const visible = { left: Math.max(rect.left, viewport.left), right: Math.min(rect.right, viewport.right), top: rect.top, bottom: rect.bottom };
		if (id && visible.left <= visible.right && visible.top < visible.bottom) geometry.clips.push({ id, rect: visible });
	}
	for (const element of layersEl.value.querySelectorAll<HTMLElement>('[data-timeline-keyframe-id]')) {
		const layerId = element.closest<HTMLElement>('[data-timeline-layer-id]')?.dataset.timelineLayerId;
		const lane = element.closest<HTMLElement>('[data-parameter-target]');
		const target = lane?.dataset.parameterTarget;
		const paramId = lane?.dataset.paramId;
		const keyframeId = element.dataset.timelineKeyframeId;
		if (!layerId || !paramId || !keyframeId || (target !== 'audio' && target !== 'module' && target !== 'compositing')) continue;
		const rect = element.getBoundingClientRect();
		const x = (rect.left + rect.right) / 2;
		const y = (rect.top + rect.bottom) / 2;
		if (x < viewport.left || x > viewport.right) continue;
		geometry.keyframes.push({ selection: { layerId, target, paramId, keyframeId }, x, y });
	}
	return geometry;
}

function onBackgroundPointerDown(event: PointerEvent) {
	suppressTimelineClick = false;
	if (event.button !== 0 || !event.isPrimary || stopSelectionDrag || panning.value || tlEl.value == null || layersEl.value == null || !(event.target instanceof Element)) return;
	const timeline = tlEl.value;
	const layers = layersEl.value;
	const target = event.target;
	if (!layersEl.value?.contains(target) && !tlEl.value.contains(target)) return;
	if (target.closest('[data-timeline-clip], [data-timeline-keyframe-id], button, input, select, textarea, [draggable="true"]')) return;
	const bounds = tlEl.value.getBoundingClientRect();
	const viewport = { left: bounds.left, right: bounds.right, top: bounds.top + X_TICKS_HEIGHT, bottom: bounds.bottom };
	if (event.clientX < viewport.left || event.clientX > viewport.right || event.clientY < viewport.top || event.clientY > viewport.bottom) return;
	event.preventDefault();
	event.stopPropagation();
	tlEl.value.focus({ preventScroll: true });
	const previous = deepClone(selection.value);
	const origin = { x: event.clientX - viewport.left, y: event.clientY - viewport.top + layers.scrollTop };
	let pointer = { x: event.clientX, y: event.clientY };
	const updateSelection = () => {
		const bounds = timeline.getBoundingClientRect();
		const viewport = { left: bounds.left, right: bounds.right, top: bounds.top + X_TICKS_HEIGHT, bottom: bounds.bottom };
		const rect = timelineMarqueeRect(origin, pointer, viewport, layers.scrollTop);
		if (!selectionArea.value && Math.hypot(rect.right - rect.left, rect.bottom - rect.top) < 3) return;
		suppressTimelineClick = true;
		selectionArea.value = { left: rect.left - bounds.left, right: rect.right - bounds.left, top: rect.top - bounds.top, bottom: rect.bottom - bounds.top };
		// 毎回開始時の選択に対して計算する。範囲を縮めたとき、途中で囲んだ要素を残さない。
		selection.value = selectTimelineRange(rect, readSelectionGeometry(viewport), previous, event.shiftKey);
	};
	// ホイールだけではpointermoveが発生しないため、静止中のポインター位置でも再計算する。
	layers.addEventListener('scroll', updateSelection);
	stopSelectionDrag = listenPointerDrag(event, current => {
		pointer = { x: current.clientX, y: current.clientY };
		updateSelection();
	}, () => {
		layers.removeEventListener('scroll', updateSelection);
		selectionArea.value = null;
		stopSelectionDrag = undefined;
	}, target as HTMLElement);
}

function startSelectionMove(event: PointerEvent, points: TimelineMovePoint[], snapTimes: number[], apply: (delta: number, mergeKey: string) => boolean) {
	if (points.length === 0) return;
	event.preventDefault();
	tlEl.value?.focus({ preventScroll: true });
	const msPerPixel = tlRangeX.value / tlElWidth.value;
	const mergeKey = genId();
	let moved = false;
	let previousDelta = 0;
	stopSelectionDrag = listenPointerDrag(event, current => {
		if (!moved && Math.abs(current.clientX - event.clientX) < 3) return;
		moved = true;
		movingSelection.value = true;
		suppressTimelineClick = true;
		const result = constrainTimelineMove((current.clientX - event.clientX) * msPerPixel, points, snapTimes, msPerPixel);
		// 移動量を決めた候補だけでなく、移動後に一致する両端・全選択キーの候補を表示する。
		// 吸着距離の5pxではなく浮動小数点の誤差だけを許容し、まだ近いだけの候補には線を出さない。
		snappingTimes.value = [...new Set(snapTimes.filter(time => points.some(point => nearlyEqual(point.time + result.delta, time))))];
		if (result.delta === previousDelta) return;
		if (!apply(result.delta, mergeKey)) { stopSelectionDrag?.(); return; }
		previousDelta = result.delta;
	}, () => {
		snappingTimes.value = [];
		movingSelection.value = false;
		stopSelectionDrag = undefined;
	});
}

function onLayerMoveStart(event: PointerEvent, layer: TimelineLayer) {
	if (event.button !== 0 || !event.isPrimary || stopSelectionDrag || tlElWidth.value <= 0 || tlRangeX.value <= 0) return;
	if (selection.value.kind !== 'layers' || !selection.value.ids.includes(layer.id)) selectLayer(layer);
	const current = selection.value;
	if (current.kind !== 'layers') return;
	const layers = sceneLayers.value.filter(entry => current.ids.includes(entry.id));
	if (layers.some(entry => entry.layerType === 'effect')) return;
	const positions = layers.map(entry => ({ layerId: entry.id, positionMs: entry.positionMs }));
	const points = layers.flatMap(entry => [getTimelineLayerStart(entry), getTimelineLayerEnd(entry)]
		.map(time => ({ time, minDelta: -getTimelineLayerStart(entry), maxDelta: Infinity })));
	const snapTimes = [0, ...xTicks.value, ...sceneLayers.value.filter(entry => !current.ids.includes(entry.id))
		.flatMap(entry => [getTimelineLayerStart(entry), getTimelineLayerEnd(entry)])];
	startSelectionMove(event, points, snapTimes, (delta, mergeKey) => {
		if (positions.some(position => !sceneLayers.value.some(entry => entry.id === position.layerId))) return false;
		appStateManager.commit('moveTimelineLayers', { sceneId: props.sceneId, positions: positions.map(position => ({ ...position, positionMs: position.positionMs + delta })) }, mergeKey);
		return true;
	});
}

function onKeyframeMoveStart(event: PointerEvent, point: TimelineKeyframeSelection) {
	if (event.button !== 0 || !event.isPrimary || stopSelectionDrag || tlElWidth.value <= 0 || tlRangeX.value <= 0) return;
	const key = keyframeSelectionKey(point);
	if (selection.value.kind !== 'keyframes' || !selection.value.keyframes.some(entry => keyframeSelectionKey(entry) === key)) onKeyframeSelected(point);
	const current = selection.value;
	if (current.kind !== 'keyframes') return;
	const selected = new Set(current.keyframes.map(keyframeSelectionKey));
	const entries = keyframeEntries.value.filter(entry => selected.has(keyframeSelectionKey(entry.selection)));
	const points = entries.map(entry => {
		const ids = new Set(current.keyframes.filter(point => point.layerId === entry.selection.layerId && point.target === entry.selection.target && point.paramId === entry.selection.paramId).map(point => point.keyframeId));
		return { time: entry.time, ...keyframeMoveBounds(entry.keyframes, ids, entry.selection.keyframeId) };
	});
	const positions = entries.map(entry => ({ ...entry.selection, x: entry.x }));
	const snapTimes = [0, time.value, ...xTicksWithHalf.value, ...sceneLayers.value.flatMap(entry => [getTimelineLayerStart(entry), getTimelineLayerEnd(entry)]),
		...keyframeEntries.value.filter(entry => !selected.has(keyframeSelectionKey(entry.selection))).map(entry => entry.time)];
	startSelectionMove(event, points, snapTimes, (delta, mergeKey) => {
		const available = new Set(keyframeEntries.value.map(entry => keyframeSelectionKey(entry.selection)));
		if (positions.some(position => !available.has(keyframeSelectionKey(position)))) return false;
		appStateManager.commit('moveTimelineKeyframes', { sceneId: props.sceneId, positions: positions.map(position => ({ ...position, x: position.x + delta })) }, mergeKey);
		return true;
	});
}

onBeforeUnmount(() => stopSelectionDrag?.());

const SNAP_THRESHOLD = 5;

function onSeekBarMousedown(ev: MouseEvent) {
	if (tlEl.value == null) return;
	ev.stopPropagation();
	const position = tlEl.value.getBoundingClientRect();

	function move(x: number, y: number) {
		previewPlayback.seekTimeline(Math.min(duration.value - 1, Math.max(0, domXToTime(x))));
	}

	dragListen(me => {
		move(me.clientX - position.left, me.clientY - position.top);
	});
}

function onTlKeydown(ev: KeyboardEvent) {
	if (ev.defaultPrevented || !(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return;
	const target = ev.target;
	if (target instanceof HTMLElement && (target.closest('input, textarea, select') || target.isContentEditable)) return;
	const key = ev.key.toLowerCase();
	if (key === 'c') {
		if (selectedLayer.value == null || selection.value.kind !== 'layers') return;
		ev.preventDefault();
		ev.stopPropagation();
		if (ev.repeat) return;
		// コピー後の編集がクリップボードの内容に影響しないよう、ここでスナップショットを作る。
		timelineLayerClipboard.layer = deepClone(selectedLayer.value);
	} else if (key === 'v') {
		if (timelineLayerClipboard.layer == null) return;
		ev.preventDefault();
		ev.stopPropagation();
		if (ev.repeat) return;
		const layer = deepClone(timelineLayerClipboard.layer);
		layer.id = genId();
		layer.positionMs = Math.max(0, time.value) - layer.trimStartMs;
		try {
			appStateManager.commit('pasteTimelineLayer', { sceneId: props.sceneId, layer, sourceLayerId: timelineLayerClipboard.layer.id });
		} catch (error) {
			void ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
			return;
		}
		selectLayer(layer);
	}
}

function formatMsToTimecode(ms: number) {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	const milliseconds = ms % 1000;
	if (milliseconds === 0) {
		return `${minutes}:${seconds.toString().padStart(2, '0')}`;
	} else {
		return `${minutes}:${seconds.toString().padStart(2, '0')}.${Math.floor(milliseconds).toString().replace(/0+$/, '')}`;
	}
}

function selectLayer(layer: TimelineLayer) {
	selection.value = { kind: 'layers', ids: [layer.id] };
	tlEl.value?.focus({ preventScroll: true });
}

function editVisualModuleTiming(target: 'position' | 'duration', value: string | number) {
	const layer = selectedLayer.value;
	const amount = Number(value);
	if (layer == null || !Number.isFinite(amount)) return;
	const positionMs = target === 'position' ? Math.max(0, amount) : layer.positionMs;
	const trimmedDurationMs = target === 'duration' ? Math.max(1, amount) : layer.trimmedDurationMs;
	appStateManager.commit('editVisualModuleLayerTiming', { sceneId: props.sceneId, layerId: layer.id, positionMs, trimmedDurationMs });
}

function onInlineVisualModuleEdit(event: VisualModuleEdit) {
	const layer = selectedLayer.value;
	if (layer?.layerType !== 'inlineVisualModule') return;
	commitVisualModuleEdit(appStateManager, { sceneId: props.sceneId, inlineVisualModuleLayerId: layer.id }, event);
}

let disposeEffectPicker: (() => void) | undefined;
onBeforeUnmount(() => {
	disposed = true;
	disposeEffectPicker?.();
	sceneEditorStates.set(editedScene, { selectedLayerId: selectedLayerId.value, rangeX: tlRangeX.value, positionX: tlPosX.value });
});

function showAddInlineNodeMenu() {
	const layer = selectedLayer.value;
	if (layer?.layerType !== 'inlineVisualModule') return;
	const layerId = layer.id;
	disposeEffectPicker?.();
	const { dispose } = ui.popup(GsEffectPicker, {}, {
		chosen: effect => {
			// 選択変更やレイヤー削除を挟んでも、ピッカーを開いた対象にだけ追加する。
			if (!sceneLayers.value.some(layer => layer.id === layerId && layer.layerType === 'inlineVisualModule')) return;
			appStateManager.commit('addEffectNode', { sceneId: props.sceneId, inlineVisualModuleLayerId: layerId, effectId: effect.id, id: genId() });
		},
		closed: () => {
			dispose();
			if (disposeEffectPicker === dispose) disposeEffectPicker = undefined;
		},
	});
	disposeEffectPicker = dispose;
}

function onVisualModuleLayerParamEdit(event: ParamEdit, target: 'module' | 'compositing' | 'audio') {
	const layer = selectedLayer.value;
	// TODO: struct / arrayの子の編集・要素操作。現在のカスタムパラメータ編集UIは末端の型だけを扱う。
	if (layer == null || event.paramPath.length !== 1) return;
	if (event.kind === 'node' || event.kind === 'externalCustomParameterInput' || event.kind === 'addElement' || event.kind === 'removeElement') return;
	if (event.kind === 'inputSource' && (event.inputSource === 'node' || event.inputSource === 'externalCustomParameterInput')) return;
	appStateManager.commit('editTimelineLayerParam', {
		sceneId: props.sceneId,
		layerId: layer.id,
		target,
		paramId: String(event.paramPath[0]),
		edit: event,
	}, event.mergeKey != null ? `${layer.id}:${target}:${event.paramPath[0]}:${event.mergeKey}` : undefined);
}

const selectedVideoMetadata = shallowRef<MediaMetadata | null>(null);
const selectedVideoAudioError = ref<string | null>(null);
const selectedVideoAsset = computed(() => {
	const layer = selectedLayer.value;
	return layer?.layerType === 'video' ? appStateManager.state.assets.value.find(asset => asset.id === layer.assetId) : undefined;
});
watch(() => selectedVideoAsset.value?.fileData, async (blob, _, onCleanup) => {
	selectedVideoMetadata.value = null;
	selectedVideoAudioError.value = null;
	let cancelled = false;
	onCleanup(() => { cancelled = true; });
	if (!blob) return;
	try {
		const result = await inspectVideoLayerAsset(blob);
		if (!cancelled) {
			selectedVideoMetadata.value = result.metadata;
			selectedVideoAudioError.value = result.audioError;
		}
	} catch (error) {
		if (!cancelled) audioError.value = error instanceof Error ? error.message : String(error);
	}
}, { immediate: true });

async function addVideoLayer(asset: Asset) {
	audioError.value = null;
	const timeline = sceneLayers.value;
	const projectAssets = appStateManager.state.assets.value;
	try {
		const { metadata, audioError: unsupportedAudio } = await inspectVideoLayerAsset(asset.fileData);
		let audioEnabled = metadata.audio != null;
		if (unsupportedAudio) {
			const result = await ui.confirm({ type: 'warning', title: asset.name, text: unsupportedAudio, okText: 'Add without audio' });
			if (result.canceled) return;
			audioEnabled = false;
		}
		// 読み取りやダイアログ中にプロジェクト・Sceneが変わった場合は追加先を取り違えない。
		if (disposed || sceneLayers.value !== timeline || appStateManager.state.assets.value !== projectAssets) return;
		if (!projectAssets.some(entry => entry.id === asset.id)) return;
		const layer: TimelineVideoLayer = {
			id: genId(), layerType: 'video', assetId: asset.id, fitMode: 'contain', audioEnabled,
			positionMs: Math.max(0, time.value), trimStartMs: 0, trimmedDurationMs: metadata.durationMs,
			compositingParamValues: deepClone(Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, def.defaultValue]))) as TimelineVideoLayer['compositingParamValues'],
			audioParamValues: { volume: deepClone(timelineAudioParamDefs.volume.defaultValue) }, automationGraphs: [],
		};
		appStateManager.commit('addVideoLayer', { sceneId: props.sceneId, layer, sourceDurationMs: metadata.durationMs });
		selectLayer(layer);
	} catch (error) { audioError.value = error instanceof Error ? error.message : String(error); }
}

const audioError = ref<string | null>(null);

async function addAudioLayer(asset: Asset) {
	audioError.value = null;
	const timeline = sceneLayers.value;
	try {
		const audio = await openAssetAudio(asset);
		const trimmedDurationMs = audio.duration * 1000;
		audio.input.dispose();
		if (!Number.isFinite(trimmedDurationMs) || trimmedDurationMs <= 0) throw new Error('Audio has no finite duration.');
		if (disposed || sceneLayers.value !== timeline) return;
		if (!appStateManager.state.assets.value.some(entry => entry.id === asset.id)) return;
		const id = genId();
		const positionMs = Math.round(time.value);
		appStateManager.commit('addAudioLayer', { sceneId: props.sceneId, layer: {
			id, layerType: 'audio', assetId: asset.id, positionMs, trimmedDurationMs, trimStartMs: 0,
			paramValues: { volume: { inputSource: 'literal', value: 1 } }, automationGraphs: [],
		} });
		selection.value = { kind: 'layers', ids: [id] };
	} catch (error) { audioError.value = error instanceof Error ? error.message : String(error); }
}

function editTrimmedLayerTiming(kind: 'move' | 'trimStart' | 'trimEnd' | 'offset', value: string | number) {
	const layer = selectedLayer.value;
	const next = Number(value);
	if ((layer?.layerType !== 'audio' && layer?.layerType !== 'scene' && layer?.layerType !== 'video') || !Number.isFinite(next)) return;
	let { positionMs, trimmedDurationMs, trimStartMs } = layer;
	if (kind === 'move') positionMs = next;
	if (kind === 'trimStart') { trimmedDurationMs -= next - getTimelineLayerStart(layer); trimStartMs = next - positionMs; }
	if (kind === 'trimEnd') trimmedDurationMs = next - getTimelineLayerStart(layer);
	if (kind === 'offset') trimStartMs = next;
	if (positionMs + trimStartMs < 0 || trimmedDurationMs <= 0 || trimStartMs < 0) return;
	if (layer.layerType === 'video') {
		const sourceDurationMs = selectedVideoMetadata.value?.durationMs;
		if (sourceDurationMs == null || trimStartMs + trimmedDurationMs > sourceDurationMs) return;
		appStateManager.commit('editVideoLayerTiming', { sceneId: props.sceneId, layerId: layer.id, positionMs, trimmedDurationMs, trimStartMs, sourceDurationMs });
	} else {
		appStateManager.commit(layer.layerType === 'scene' ? 'editSceneLayerTiming' : 'editAudioLayerTiming', { sceneId: props.sceneId, layerId: layer.id, positionMs, trimmedDurationMs, trimStartMs });
	}
}

function addSceneLayer() {
	const scene = availableScenes.value.find(scene => scene.id === sceneToAdd.value);
	if (scene == null) return;
	const layer = {
		id: genId(), layerType: 'scene' as const, sceneId: scene.id,
		positionMs: Math.max(0, time.value), trimStartMs: 0, trimmedDurationMs: getSceneDuration(scene),
		compositingParamValues: deepClone(Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, def.defaultValue]))) as import('@glitch/shared/timeline/types.ts').TimelineSceneLayer['compositingParamValues'],
		audioParamValues: { volume: deepClone(timelineAudioParamDefs.volume.defaultValue) }, automationGraphs: [],
	};
	appStateManager.commit('addSceneLayer', { sceneId: props.sceneId, layer });
	selectLayer(layer);
}

function play() {
	previewPlayback.playTimeline();
}

function pause() {
	previewPlayback.pauseTimeline();
}

function showAddLayerMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: 'Visual Module (Inline)',
		icon: 'ti ti-chart-dots-3',
		action: () => {
			const layer = createInlineVisualModuleLayer(Math.max(0, time.value));
			appStateManager.commit('addInlineVisualModuleLayer', { sceneId: props.sceneId, layer });
			selectLayer(layer);
			visualModuleLayerTab.value = 'module';
			previewPlayback.seekTimeline(getTimelineLayerStart(layer));
		},
	}, {
		text: 'Visual Module (Reference)',
		icon: 'ti ti-chart-dots-3',
		action: () => {
			// TODO
		},
	}, {
		text: 'Video',
		icon: 'ti ti-video',
		action: async () => {
			const { canceled, result: assetId } = await ui.select({
				title: 'Select Video Asset',
				items: appStateManager.state.assets.value.filter(asset => asset.fileDataType.startsWith('video/')).map(asset => ({ label: asset.name, value: asset.id })),
			});
			if (canceled || assetId == null) return;
			addVideoLayer(appStateManager.state.assets.value.find(asset => asset.id === assetId)!);
		},
	}, {
		text: 'Audio',
		icon: 'ti ti-music',
		action: async () => {
			const { canceled, result: assetId } = await ui.select({
				title: 'Select Audio Asset',
				items: appStateManager.state.assets.value.filter(asset => asset.fileDataType.startsWith('audio/')).map(asset => ({ label: asset.name, value: asset.id })),
			});
			if (canceled || assetId == null) return;
			addAudioLayer(appStateManager.state.assets.value.find(asset => asset.id === assetId)!);
		},
	}], ev.currentTarget ?? ev.target);
}

function formatFullTimecode(timeMs: number): string {
	const ms = Math.floor(timeMs);
	const hours = String(Math.floor(ms / 3600000)).padStart(2, '0');
	const minutes = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
	const seconds = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
	const milliseconds = String(ms % 1000).padStart(3, '0');
	return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

let resizeObserver: ResizeObserver | undefined;
onBeforeUnmount(() => resizeObserver?.disconnect());
onMounted(() => {
	if (tlEl.value == null) return;
	tlElWidth.value = tlEl.value.offsetWidth;
	tlElHeight.value = tlEl.value.offsetHeight;

	resizeObserver = new ResizeObserver(() => {
		if (tlEl.value == null) return;
		tlElWidth.value = tlEl.value.offsetWidth;
		tlElHeight.value = tlEl.value.offsetHeight;
	});

	resizeObserver.observe(tlEl.value);
});
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	height: 100%;
	contain: content;

	--sideWidth: 300px;
	--xTicksHeight: v-bind('X_TICKS_HEIGHT + "px"');
	--yTicksWidth: v-bind('Y_TICKS_WIDTH + "px"');

	--accentAlphaMiddle: color(from var(--THEME-accent) srgb r g b / 0.5);
	--accentAlphaLow: color(from var(--THEME-accent) srgb r g b / 0.25);
	--accentAlphaMiddleLow: color(from var(--THEME-accent) srgb r g b / 0.35);
	--accentAlphaVeryLow: color(from var(--THEME-accent) srgb r g b / 0);
}

.header {
	display: grid;
	grid-template-columns: 1fr 1fr 1fr 1fr;
	gap: 4px;
	padding: 4px;
}
.headerLeft {
	display: flex;
	align-items: center;
	gap: 4px;
	justify-content: flex-start;
}
.headerCenter {
	display: flex;
	align-items: center;
	gap: 4px;
	justify-content: center;
}
.headerRight {
	display: flex;
	align-items: center;
	gap: 4px;
	justify-content: flex-end;
}

.audioAssetSelect {
	width: 180px;
}

.body {
	position: relative;
	flex: 1;
	display: flex;
}

//.panning,
//.panning * {
//	cursor: grabbing !important;
//	user-select: none;
//}

.layers {
	touch-action: none;
	display: flex;
	flex-direction: column;
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	overflow: auto;
	scrollbar-gutter: stable;
	direction: rtl; /* スクロールバーを左に表示したいため */
}

.layersHeader {
	flex-shrink: 0;
	direction: ltr;
	height: 40px;
}

.layerList {
	flex-shrink: 0;
	flex-wrap: nowrap;
}

.layersLane {
	direction: ltr;
}

.yTicks {
	position: absolute;
	z-index: 1000;
	top: 0;
	left: 0;
	height: 100%;
	width: var(--yTicksWidth);
	background: #181818aa;
	backdrop-filter: blur(24px);
	overflow: clip;
	contain: content;
}
.yTick {
	position: absolute;
	left: 0;
	width: 100%;
	font-size: 12px;
	padding: 4px 8px 0 0;
	box-sizing: border-box;
	border-top: solid 1px #fff1;
	text-align: right;
}
.yTickActive {
	border-top: solid 1px var(--accentAlphaMiddle);
}

.xTicks {
	position: absolute;
	z-index: 1000;
	top: 0;
	left: 0;
	width: 100%;
	height: var(--xTicksHeight);
	background: #181818aa;
	backdrop-filter: blur(24px);
	overflow: clip;
	contain: content;
	pointer-events: auto;
}
.xTick {
	position: absolute;
	top: 0;
	height: 100%;
	line-height: var(--xTicksHeight);
	font-size: 12px;
	padding: 0 0 0 8px;
	border-left: solid 1px #fff3;
}

.ticksCorner {
	position: absolute;
	z-index: 1000;
	top: 0;
	left: 0;
	width: var(--yTicksWidth);
	height: var(--xTicksHeight);
	background: #181818;
}

.tlBgWrapper { /* tl自体はスクロールバーを表示しないが、layers側で表示するスクロールバーにより位置がずれるため、補正するためにこっちでもスクロールバーの幅だけは確保しておく */
	display: flex;
	flex-direction: row;
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	overflow: auto;
	scrollbar-gutter: stable;
	direction: rtl; /* スクロールバーを左に表示したいため */
	flex-direction: row-reverse;
}
.tlBgSideSpacer {
	box-sizing: border-box;
	width: var(--sideWidth);
}

.tlBg {
	height: 100%;
	flex: 1;
	overflow: clip;
	background-size: auto auto;
	background-color: #2d2d2d;
	background-image: repeating-linear-gradient(45deg, transparent, transparent 6px, #222222 6px, #222222 12px );
	contain: content;
	direction: ltr;

	&:focus {
		outline: none;
		//outline: solid 7px #fff;
	}
}

.tlOverlayWrapper { /* tl自体はスクロールバーを表示しないが、layers側で表示するスクロールバーにより位置がずれるため、補正するためにこっちでもスクロールバーの幅だけは確保しておく */
	display: flex;
	flex-direction: row;
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	overflow: auto;
	scrollbar-gutter: stable;
	direction: rtl; /* スクロールバーを左に表示したいため */
	flex-direction: row-reverse;
	pointer-events: none;
}
.tlOverlaySideSpacer {
	box-sizing: border-box;
	width: var(--sideWidth);
}

.tlOverlay {
	height: 100%;
	flex: 1;
	overflow: clip;
	contain: content;
	pointer-events: none;
	direction: ltr;

	&:focus {
		outline: none;
		//outline: solid 7px #fff;
	}
}

.lines {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	color: var(--THEME-accent);
}

.inTlXTick {
	position: absolute;
	top: 0;
	height: 100%;
	border-left: dotted 1px #fff1;
	pointer-events: none;
}
.inTlXTickZero {
	border-left: solid 1px #fff2;
}

.inTlYTick {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	border-top: dotted 1px #fff1;
	pointer-events: none;
}
.inTlYTickZero {
	border-top: solid 1px #fff2;
}
.inTlYTickActive {
	border-top: solid 1px var(--accentAlphaMiddle);
}

.xTicksSeekBar {
	position: absolute;
	top: 0;
	height: 100%;
	width: 3px;
	background: #FF5500;
	cursor: ew-resize;
	will-change: left;

	&::before {
		content: "";
		display: block;
		position: absolute;
		top: 0;
		left: -7px;
    width: 16px;
		height: 100%;
	}
}

.seekBar {
	position: absolute;
	top: var(--xTicksHeight);
	height: calc(100% - var(--xTicksHeight));
	width: 1px;
	background: #FF5500;
	pointer-events: none;
	will-change: left;

	&::before {
		content: "";
		display: block;
		position: absolute;
		top: 0;
		right: 0;
		width: 32px;
		height: 100%;
		background: linear-gradient(270deg, #FF550055, #FF550000);
	}
}
.seekBarFrame {
	display: inline-block;
	background: #FF5500;
	color: #fff;
	min-width: 5em;
	corner-shape: bevel;
	border-radius: 0 0 6px 0;
}

.valueBar {
	position: absolute;
	left: var(--yTicksWidth);
	width: calc(100% - var(--yTicksWidth));
	height: 1px;
	background: #FF5500;
	pointer-events: none;
	will-change: top;
}
.valueBarValue {
	display: inline-block;
	background: #FF5500;
	color: #fff;
	min-width: 40px;
}

.crossPoint {
	position: absolute;
	z-index: 10;
	width: 9px;
	height: 9px;
	margin-left: -4px;
	margin-top: -4px;
	border-radius: 100%;
	background: #FF5500;
	pointer-events: none;
	will-change: top, left;
}

.snapLine {
	position: absolute;
	top: var(--xTicksHeight);
	bottom: 0;
	z-index: 1;
	border-left: 1px solid var(--THEME-accent);
	pointer-events: none;
}

.cursorBar {
	position: absolute;
	top: 0;
	height: 100%;
	width: 1px;
	background: #fff1;
}

.automationGraph {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
}

@keyframes blink {
	0% { opacity: 1; transform: scale(1); }
	30% { opacity: 1; transform: scale(1); }
	90% { opacity: 0; transform: scale(0.5); }
}

.tlRange {
	position: absolute;
	top: 0;
	background: #222;
	height: 100%;
}

.selectedArea {
	position: absolute;
	background: #fff1;
	border: 1px solid var(--THEME-accent);
	box-sizing: border-box;
}

.tooltip {
	position: absolute;
	background: #0005;
	color: #fff;
	padding: 6px 10px;
	font-size: 13px;
}

.infoBar {
	display: flex;
	position: absolute;
	bottom: 0;
	left: var(--yTicksWidth);
	box-sizing: border-box;
	padding: 0 8px;
	width: calc(100% - var(--yTicksWidth));
	height: 22px;
	line-height: 22px;
	font-size: 13px;
	background: #0008;
	color: #fff;
	overflow: clip;
	contain: strict;
	pointer-events: none;

	> div { // TODO: ちゃんとクラス指定する
		flex: 1;

		> b {
			margin-right: 1em;
			font-weight: normal;
			opacity: 0.7;

			&:after {
				content: ':';
			}
		}

		> code {
			display: inline-block;
			min-width: 4em;
		}
	}
}

.rightSidePanel {
	overflow-y: auto;
	position: absolute;
	top: 0;
	right: 0;
	box-sizing: border-box;
	width: 400px;
	height: 100%;
	background: #0008;
	backdrop-filter: blur(4px);
	color: #fff;
}

.inlineModuleEditor {
	flex: 1;
	min-height: 0;
}

.layerSettings {
	min-height: 0;
	overflow-y: auto;
}

.keyframeEditor {
	display: grid;
	gap: 12px;
	padding: 16px;
}

</style>
