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
			<GsButton v-tooltip="'Timeline tick settings'" small iconOnly @click="showTickMenu"><i class="ti ti-ruler-2"></i></GsButton>
			<GsButton v-tooltip="'Snap settings'" small iconOnly :primary="snapEnabled" @click="showSnapMenu"><i class="ti ti-magnet"></i></GsButton>
		</div>
	</div>
	<div :class="[$style.body, { [$style.panning]: panning }]" @pointerdown.capture="onBackgroundPointerDown" @click.capture="onTimelineClick" @mousedown.capture="onPanMousedown" @auxclick.capture="onPanAuxclick" @wheel.capture="onTimelineWheel">
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
						:tlPosX="tlPosX"
						:layer="layer"
						:sceneId="sceneId"
						:tlElWidth="tlElWidth"
						:tlRangeX="tlRangeX"
						:clipTicks="clipTicksByLayer.get(layer.id) ?? new Map()"
						:mediaInfo="mediaInfo"
						:selectedClipIds="selection.kind === 'clips' ? selection.clips.filter(clip => clip.layerId === layer.id).map(clip => clip.clipId) : []"
						:selectedKeyframes="selection.kind === 'keyframes' ? selection.keyframes : []"
						:class="$style.layersLane"
						:selected="selection.kind === 'layers' && selection.ids.includes(layer.id)"
						:moving="movingSelection"
						@dragStart="dragStart"
						@selected="event => selectLayer(layer, event)"
						@addClip="startMs => addClip(layer, startMs)"
						@look="center => tlPosX = center - tlRangeX / 2"
						@clipMoveStart="onClipMoveStart"
						@clipTrimStart="onClipTrimStart"
						@keyframeDragStart="onKeyframeMoveStart"
						@keyframeSelected="onKeyframeSelected"
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
					<div v-for="time of xMinorTicks" :class="$style.xMinorTick" :style="{ left: timeToDomX(time) + 'px' }"></div>
					<div :class="$style.xTicksSeekBar" :style="{ left: (seekBarPos - 1) + 'px' }" @pointerdown="onSeekBarPointerDown"></div>
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
			<GsFolder v-if="selectedKeyframe != null" :key="keyframeEditorKey" defaultOpen asSection :withSpacer="false">
				<template #icon><i class="ti ti-keyframe"></i></template>
				<template #label>Keyframe: {{ selectedKeyframe.def.ui.label }}</template>
				<div style="margin-left: 16px; border-left: solid 1px #fff2;">
					<div class="_spacer _gaps_m">
						<GsInput small type="number" :min="selectedKeyframe.minX" :max="selectedKeyframe.maxX" :modelValue="selectedKeyframe.keyframe.x" @update:modelValue="updateKeyframeTime">
							<template #label>Time</template>
							<template #suffix>ms</template>
						</GsInput>
						<div>Value</div>
						<GsLiteralLeafValueControl
							:dataType="selectedKeyframe.def.dataType"
							:control="selectedKeyframe.def.ui.control"
							:value="selectedKeyframe.keyframe.value"
							:title="selectedKeyframe.def.ui.label"
							@input="value => updateKeyframeValue(value)"
							@beginChanging="keyframeValueMergeKey = genId()"
							@changeContinuous="value => updateKeyframeValue(value, keyframeValueMergeKey)"
							@changeFinished="keyframeValueMergeKey = null"
							@reset="updateKeyframeValue(selectedKeyframe.def.defaultValue.value)"
						/>
						<template v-for="editor in keyframeInterpolationEditors" :key="editor.keyframe.id">
							<GsSelect small :modelValue="editor.keyframe.interpolation.type" :items="keyframeInterpolationItems" @update:modelValue="type => updateKeyframeInterpolationType(editor.keyframe.id, type)">
								<template #label>{{ editor.label }}</template>
							</GsSelect>
							<GsSelect v-if="editor.direction != null" small :modelValue="editor.direction" :items="easingDirectionItems" @update:modelValue="direction => updateKeyframeEasingDirection(editor.keyframe.id, direction)">
								<template #label>Easing direction</template>
							</GsSelect>
						</template>
						<GsButton danger small><i class="ti ti-trash"></i> Remove Keyframe</GsButton>
					</div>
				</div>
			</GsFolder>
			<GsFolder v-if="selectedClipEntry != null" defaultOpen asSection :withSpacer="false">
				<template #icon><i class="ti ti-ticket"></i></template>
				<template #label>Clip: {{ selectedClipLabel }}</template>
				<div style="margin-left: 16px; border-left: solid 1px #fff2;">
					<div class="_spacer _gaps_m">
						<GsInput small type="number" :min="0" :modelValue="selectedClipEntry.clip.startMs" @update:modelValue="value => editSelectedClipTime('move', value)"><template #label>Start</template><template #suffix>ms</template></GsInput>
						<GsInput small type="number" :min="0" :disabled="selectedClipNeedsMedia && !selectedClipMedia" :modelValue="selectedClipEntry.clip.startMs" @update:modelValue="value => editSelectedClipTime('start', value)"><template #label>Trim start</template><template #suffix>ms</template></GsInput>
						<GsInput small type="number" :min="1" :disabled="selectedClipNeedsMedia && !selectedClipMedia" :modelValue="selectedClipEntry.clip.durationMs" @update:modelValue="value => editSelectedClipTime('duration', value)"><template #label>Duration</template><template #suffix>ms</template></GsInput>
						<div>Content offset: {{ formatMsToTimecode(selectedClipEntry.clip.contentOffsetMs) }}</div>
						<div v-if="selectedClipMedia">Source duration: {{ formatMsToTimecode(selectedClipMedia.durationMs) }}</div>
						<template v-if="selectedVideoClip != null">
							<GsSwitch :modelValue="selectedVideoClip.audioEnabled" :disabled="!selectedVideoClip.audioEnabled && !selectedClipMedia?.audioAvailable" @update:modelValue="editSelectedClipAudio">Audio enabled</GsSwitch>
							<div v-if="selectedClipMedia?.audioError">{{ selectedClipMedia.audioError }}</div>
						</template>
						<GsButton v-if="selectedClipEntry.layer.layerType === 'image' || selectedClipEntry.layer.layerType === 'video' || selectedClipEntry.layer.layerType === 'audio' || selectedClipEntry.layer.layerType === 'scene'" small @click="changeClipSource">Change source</GsButton>
						<GsButton v-if="selectedSceneClip != null" small @click="activeSceneId = selectedSceneClip.sceneId">Open scene</GsButton>
						<GsButton danger small @click="removeSelectedClips"><i class="ti ti-trash"></i> Remove Clip</GsButton>
					</div>
				</div>
			</GsFolder>
			<GsFolder v-if="selectedLayer != null" defaultOpen asSection :withSpacer="false">
				<template #icon><i class="ti ti-stack-middle"></i></template>
				<template #label>Layer: {{ selectedLayer?.name }}</template>

				<div style="margin-left: 16px; border-left: solid 1px #fff2;">
					<div class="_spacer">
						<GsInput small :modelValue="selectedLayer.name" @update:modelValue="name => appStateManager.commit('renameTimelineLayer', { sceneId, layerId: selectedLayer!.id, name: String(name) })"><template #label>Layer Name</template></GsInput>
					</div>
					<GsTimelineEffectSettings
						v-if="selectedLayer.layerType === 'effect'"
						:key="selectedLayer.id"
						:layer="selectedLayer"
						:effectState="selectedEffectLayerState"
						:contextResolution="getSceneBaseResolution(editedScene.resolution, appStateManager.state.resolution.value)"
						@edit="event => onTimelineLayerParamEdit(event, 'effect')"
						@resolution="resolution => appStateManager.commit('changeEffectLayerResolution', { sceneId, layerId: selectedLayer!.id, resolution })"
					/>
					<GsFolder v-if="selectedLayer.layerType === 'inlineVisualModule'" :asSection="true" defaultOpen :withSpacer="false">
						<template #icon><i class="ti ti-chart-dots-3"></i></template>
						<template #label>Visual Module</template>
						<div>
							<GsVisualModuleEditor

								:key="selectedLayer.id"
								:class="$style.inlineModuleEditor"
								:visualModule="selectedLayer.visualModule"
								:effectStates="inlineEffectStates"
								@edit="onInlineVisualModuleEdit"
								@requestAddNode="showAddInlineNodeMenu"
							/>
						</div>
					</GsFolder>
					<GsFolder v-if="selectedLayerModule != null" :asSection="true" defaultOpen :withSpacer="false">
						<template #icon><i class="ti ti-adjustments-horizontal"></i></template>
						<template #label>Module Parameters</template>
						<div style="padding: 8px 0;">
							<!-- TODO: struct / array / anyのカスタムパラメータ編集UI。型定義では許可するが、子の編集や配列操作は未対応。 -->
							<template
								v-for="paramDef of selectedLayerModule?.paramDefs.filter(paramDef => paramDef.id !== selectedLayerModule?.primaryInputId) ?? []"
								:key="`${selectedLayer.id}:${paramDef.id}`"
							>
								<div v-if="paramDef.dataType.kind === 'struct' || paramDef.dataType.kind === 'array' || isParameterType(paramDef, 'any')">{{ paramDef.ui.label }}: Editing is not yet supported.</div>
								<GsVisualParam
									v-else
									keyframesEnabled
									:automationGraphEndEnabled="false"
									:availableVariables="LAYER_VAR_DEFS"
									:automationGraphs="selectedLayer.automationGraphs"
									:paramPath="[paramDef.id]"
									:paramDef="{ ...paramDef, canNode: false }"
									:paramValue="getLayerParameterValues(selectedLayer, 'module')[paramDef.id] ?? paramDef.defaultValue"
									@edit="event => onTimelineLayerParamEdit(event, 'module')"
								/>
							</template>
						</div>
					</GsFolder>
					<GsFolder v-if="selectedLayer.layerType !== 'audio'" :asSection="true" defaultOpen :withSpacer="false">
						<template #icon><i class="ti ti-layers-selected"></i></template>
						<template #label>Compositing</template>
						<div style="padding: 8px 0;">
							<GsVisualParam
								v-for="(paramDef, paramId) in timelineCompositingParamDefs"
								:key="paramId"
								keyframesEnabled
								:automationGraphEndEnabled="false"
								:availableVariables="LAYER_VAR_DEFS"
								:automationGraphs="selectedLayer.automationGraphs"
								:paramPath="[paramId]"
								:paramDef="paramDef"
								:paramValue="selectedLayer.compositingParamValues[paramId]"
								@edit="event => onTimelineLayerParamEdit(event, 'compositing')"
							/>
						</div>
					</GsFolder>
					<GsFolder v-if="selectedLayer.layerType === 'audio' || selectedLayer.layerType === 'video' || selectedLayer.layerType === 'scene'" :asSection="true" defaultOpen>
						<template #icon><i class="ti ti-music"></i></template>
						<template #label>Audio</template>
						<div class="_gaps_m">
							<GsVisualParam
								:key="selectedLayer.id"
								keyframesEnabled
								:automationGraphEndEnabled="false"
								:availableVariables="LAYER_VAR_DEFS"
								:automationGraphs="selectedLayer.automationGraphs"
								:paramPath="['volume']"
								:paramDef="timelineAudioParamDefs.volume"
								:paramValue="selectedLayer.audioParamValues.volume"
								@edit="event => onTimelineLayerParamEdit(event, 'audio')"
							/>
						</div>
					</GsFolder>
					<GsFolder :asSection="true" defaultOpen>
						<template #label>Other</template>
						<div class="_gaps_m">
							<GsButton danger small @click="appStateManager.commit('removeTimelineLayer', { sceneId: props.sceneId, layerId: selectedLayer.id })"><i class="ti ti-trash"></i> Remove Layer</GsButton>
						</div>
					</GsFolder>
				</div>
			</GsFolder>
		</Teleport>
		<div v-else :class="$style.rightSidePanel">
			<!-- TODO -->
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { createTimelineClipTiming, getTimelineClipEnd, getTimelineClipInsertionDuration, getTimelineClipMoveBounds, getTimelineClipTrimBounds } from '@gs/subsystems_timeline_shared/timing.ts';
import { isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { LAYER_VAR_DEFS } from '@gs/subsystems_timeline_shared/expression.ts';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { insertIntermediateNumbers, niceScale } from '@gs/shared/utility/misc.js';
import { genId } from '@gs/shared/utility/id.js';
import { timelineAudioParamDefs } from '@gs/subsystems_timeline_shared/timeline-audio.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { canReferenceScene } from '@gs/subsystems_timeline_shared/scenes.ts';
import { getSceneBaseResolution } from '@gs/subsystems_timeline_shared/scene-resolution.ts';
import { paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
import { supportsKeyframeInterpolation } from '@gs/shared/keyframes/keyframes-timeline.ts';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import XLayer from './GsTimeline.Layer.vue';
import GsTimelineEffectSettings from './GsTimeline.EffectSettings.vue';
import GsLiteralLeafValueControl from './GsLiteralLeafValueControl.vue';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import GsSwitch from './common/GsSwitch.vue';
import GsButton from './common/GsButton.vue';
import GsDraggable from './common/GsDraggable.vue';
import GsVisualParam from './GsVisualParam.vue';
import GsVisualModuleEditor from './GsVisualModuleEditor.vue';
import GsEffectPicker from './GsEffectPicker.vue';
import GsFolder from './common/GsFolder.vue';
import type { TimelineParameterTarget } from '@/utility/timeline-scene.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { VisualModuleEdit } from '@/types/visual-module-editor.ts';
import type { TimelineLayer, TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineEffectParameterBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { KeyframeInterpolation } from '@gs/shared/keyframes/keyframes-timeline.ts';
import type { EasingDirection } from '@gs/shared/easing.ts';
import type { GsSelectItem } from './common/GsSelect.vue';
import type { TimelineClipSelection, TimelineKeyframeSelection, TimelineSelection, TimelineSelectionGeometry, SelectionRect, TimelineMovePoint } from '@/utility/timeline-selection.ts';
import type { ParamEdit } from './GsVisualParam.vue';
import type { TimelineClipMediaInfo } from '@/utility/timeline-clip-media.ts';
import { createKeyframeStretch, stretchKeyframeX } from '@/utility/timeline-keyframe-stretch.ts';
import { zoomTimelineX } from '@/utility/timeline-zoom.ts';
import { getTimelineTickCount, getTimelineTicks, getTimelineMinorTicks, getTimelineClipTicks, formatTimelineTimecode as formatMsToTimecode } from '@/utility/timeline-ticks.ts';
import { getTimelineClipSnapPoints, getTimelineSnapCandidates, getTimelineSeekPosition } from '@/utility/timeline-snapping.ts';
import { preferences } from '@/preferences.ts';
import { listenPointerDrag } from '@/utility/pointer-drag.ts';
import { getLayerParameterValues, getLayerParameterDefinition, resolveLayerParameter, getLayerKeyframeParameters } from '@/utility/timeline-scene.ts';
import { inspectTimelineClipMedia } from '@/utility/timeline-clip-media.ts';
import { timelineMarqueeRect, selectTimelineRange, clipSelectionKey, keyframeSelectionKey, getTimelineStretchSelection, constrainTimelineMove, keyframeMoveBounds, getTimelineSnappingTimes } from '@/utility/timeline-selection.ts';
import { canEditKeyframesTimeline, updateInlineKeyframe } from '@/utility/keyframes-timeline.ts';
import { createEffectTimelineLayer } from '@/utility/effect-timeline-layer.ts';
import { sceneEditorStates, timelineLayerClipboard } from '@/utility/timeline-editor-state.ts';
import * as ui from '@/ui.ts';
import { createInlineVisualModuleLayer } from '@/utility/inline-visual-module-layer.ts';
import { commitVisualModuleEdit } from '@/utility/visual-module-edit.ts';
import { appStateManager, activeSceneId, previewPlayback, timelineAudioPreview, timelineRendererManagerController, timelineSubPanelTeleportTargetAvailable } from '@/app.ts';
import { dragListen } from '@/utility/drag.ts';

const props = defineProps<{ sceneId: string }>();
const tickMode = preferences.model('timelineTickMode');
const halfTicks = preferences.model('timelineHalfTicks');
const thirdTicks = preferences.model('timelineThirdTicks');
const tickSubdivisions = computed(() => ({ halves: halfTicks.value, thirds: thirdTicks.value }));
const snapEnabled = preferences.model('timelineSnapEnabled');
const snapClipStart = preferences.model('timelineSnapClipStart');
const snapClipEnd = preferences.model('timelineSnapClipEnd');
const snapToSeekBar = preferences.model('timelineSnapToSeekBar');
const snapGlobalTicks = preferences.model('timelineSnapGlobalTicks');
const snapLocalTicks = preferences.model('timelineSnapLocalTicks');
const snapSeekBar = preferences.model('timelineSnapSeekBar');
const snapSettings = computed(() => ({ enabled: snapEnabled.value, globalTicks: snapGlobalTicks.value, localTicks: snapLocalTicks.value, seekBar: snapToSeekBar.value }));
const clipSnapSettings = computed(() => ({ start: snapClipStart.value, end: snapClipEnd.value }));

function showTickMenu(event: PointerEvent) {
	ui.popupMenu([{
		type: 'label', text: 'Timeline ticks',
	}, {
		type: 'radioOption', text: 'Original',
		active: computed(() => tickMode.value === 'legacy'),
		action: () => { tickMode.value = 'legacy'; },
	}, {
		type: 'radioOption', text: 'Binary (1, 0.5, 0.25, …)',
		active: computed(() => tickMode.value === 'binary'),
		action: () => { tickMode.value = 'binary'; },
	}, {
		type: 'radioOption', text: '1–2–5 (1, 0.5, 0.2, …)',
		active: computed(() => tickMode.value === 'decimal125'),
		action: () => { tickMode.value = 'decimal125'; },
	}, {
		type: 'divider',
	}, {
		type: 'label', text: 'Subdivisions (display and snap)',
	}, {
		text: 'Midpoints (1/2)', type: 'switch', ref: halfTicks,
	}, {
		text: 'Thirds (1/3, 2/3)', type: 'switch', ref: thirdTicks,
	}], event.currentTarget ?? event.target);
}

function showSnapMenu(event: PointerEvent) {
	ui.popupMenu([{
		text: 'Enable Snapping', type: 'switch', ref: snapEnabled,
	}, {
		type: 'divider',
	}, {
		type: 'label', text: 'What Snaps',
	}, {
		text: 'Clip Start', type: 'switch', ref: snapClipStart, disabled: computed(() => !snapEnabled.value),
	}, {
		text: 'Clip End', type: 'switch', ref: snapClipEnd, disabled: computed(() => !snapEnabled.value),
	}, {
		type: 'divider',
	}, {
		type: 'label', text: 'Snap to',
	}, {
		text: 'Global Ticks', type: 'switch', ref: snapGlobalTicks, disabled: computed(() => !snapEnabled.value),
	}, {
		text: 'Clip Local Ticks', type: 'switch', ref: snapLocalTicks, disabled: computed(() => !snapEnabled.value),
	}, {
		text: 'Seekbar', type: 'switch', ref: snapToSeekBar, disabled: computed(() => !snapEnabled.value),
	}, {
		type: 'divider',
	}, {
		text: 'Snap Seekbar to Global Ticks', type: 'switch', ref: snapSeekBar, disabled: computed(() => !snapEnabled.value),
	}], event.currentTarget ?? event.target);
}

const editedScene = appStateManager.state.timelineScenes.value.find(scene => scene.id === props.sceneId)!;
const editorState = sceneEditorStates.get(editedScene);
let disposed = false;
const sceneLayers = computed(() => appStateManager.state.timelineScenes.value.find(scene => scene.id === props.sceneId)?.layers ?? []);
const availableScenes = computed(() => appStateManager.state.timelineScenes.value.filter(scene => canReferenceScene(appStateManager.state.timelineScenes.value, props.sceneId, scene.id)));

const X_TICKS_HEIGHT = 20;
const Y_TICKS_WIDTH = 0;

function onLayersSorted(layers: TimelineLayer[]) {
	const layerIds = layers.map(layer => layer.id);
	if (layerIds.length === sceneLayers.value.length && layerIds.every((id, index) => id === sceneLayers.value[index]?.id)) return;
	appStateManager.commit('reorderTimelineLayers', { sceneId: props.sceneId, layerIds });
}

const duration = computed(() => {
	return sceneLayers.value.reduce((max, layer) => layer.clips.reduce((end, clip) => Math.max(end, getTimelineClipEnd(clip)), max), 0);
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

const selection = ref<TimelineSelection>(editorState?.selection ? deepClone(editorState.selection) : { kind: 'layers', ids: [] });
const selectionCount = computed(() => selection.value.kind === 'layers' ? selection.value.ids.length : selection.value.kind === 'clips' ? selection.value.clips.length : selection.value.keyframes.length);
const selectedLayerId = computed(() => selection.value.kind === 'layers' ? selection.value.ids[0] ?? null : selection.value.kind === 'clips' ? selection.value.clips[0]?.layerId ?? null : selection.value.keyframes[0]?.layerId ?? null);
const selectedLayer = computed(() => selectionCount.value > 1 ? null : sceneLayers.value.find(layer => layer.id === selectedLayerId.value) ?? null);
const selectedLayerModule = computed(() => {
	const layer = selectedLayer.value;
	return layer?.layerType === 'inlineVisualModule' ? layer.visualModule
		: layer?.layerType === 'visualModule' ? appStateManager.getVisualModuleById(layer.visualModuleId) : null;
});
const inlineEffectStates = computed(() => previewPlayback.state.value.mode === 'timeline' && selectedLayer.value != null
	? timelineRendererManagerController.getLayerEffectStates(props.sceneId, selectedLayer.value.id) : undefined);
const selectedEffectLayerState = computed(() => previewPlayback.state.value.mode === 'timeline' && selectedLayer.value?.layerType === 'effect'
	? timelineRendererManagerController.getEffectLayerState(props.sceneId, selectedLayer.value.id) : undefined);

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
	if (layer == null) return null;
	let binding: TimelineEffectParameterBinding;
	try { binding = resolveLayerParameter(appStateManager.state, layer, selection.target, selection.paramPath).value; } catch { return null; }
	if (binding?.inputSource !== 'keyframesTimelineInline') return null;
	const def = getLayerParameterDefinition(appStateManager.state, layer, selection.target, selection.paramPath);
	if (def == null || !canEditKeyframesTimeline(def, binding)) return null;
	const keyframes = binding.keyframesTimeline.keyframes.toSorted((a, b) => a.x - b.x);
	const index = keyframes.findIndex(entry => entry.id === selection.keyframeId);
	if (index < 0) return null;
	return {
		selection, binding, def, keyframe: keyframes[index],
		previousKeyframe: keyframes[index - 1] ?? null,
		minX: Math.max(0, keyframes[index - 1]?.x ?? -Infinity),
		maxX: keyframes[index + 1]?.x ?? Infinity,
	};
});

const keyframeInterpolationItems: GsSelectItem<KeyframeInterpolation['type']>[] = [
	{ label: 'Hold', value: 'hold' },
	{ label: 'Linear', value: 'linear' },
	{ label: 'Sine', value: 'ease:sine' },
	{ label: 'Quad', value: 'ease:quad' },
	{ label: 'Cubic', value: 'ease:cubic' },
	{ label: 'Quart', value: 'ease:quart' },
	{ label: 'Quint', value: 'ease:quint' },
	{ label: 'Expo', value: 'ease:expo' },
	{ label: 'Circ', value: 'ease:circ' },
	{ label: 'Back', value: 'ease:back' },
	{ label: 'Elastic', value: 'ease:elastic' },
	{ label: 'Bounce', value: 'ease:bounce' },
];
const easingDirectionItems: GsSelectItem<EasingDirection>[] = [
	{ label: 'In', value: 'in' },
	{ label: 'Out', value: 'out' },
	{ label: 'InOut', value: 'inOut' },
];
const keyframeInterpolationEditors = computed(() => {
	const selected = selectedKeyframe.value;
	if (selected == null || !supportsKeyframeInterpolation(selected.def.dataType)) return [];
	const editors = [{ keyframe: selected.keyframe, label: 'Interpolation to next keyframe' }];
	// このキーまでの補間は直前のキーが所有する。選択は維持し、編集先のIDだけを切り替える。
	if (selected.previousKeyframe != null) {
		editors.unshift({ keyframe: selected.previousKeyframe, label: 'Interpolation from previous keyframe' });
	}
	return editors.map(editor => ({
		...editor,
		direction: 'direction' in editor.keyframe.interpolation ? editor.keyframe.interpolation.direction : null,
	}));
});

watch(selectedKeyframeSelection, () => { keyframeValueMergeKey.value = null; });
watch(selectedKeyframe, value => {
	if (value == null && selectedKeyframeSelection.value != null) selectedKeyframeSelection.value = null;
});

function onKeyframeSelected(selection: TimelineKeyframeSelection) {
	selectedKeyframeSelection.value = selection;
}

function updateKeyframe(keyframeId: string, patch: { x?: number; value?: unknown; interpolation?: KeyframeInterpolation }, mergeKey?: string | null) {
	const selected = selectedKeyframe.value;
	if (selected == null) return;
	const value = updateInlineKeyframe(selected.binding, selected.def, keyframeId, patch);
	if (value == null) return;
	appStateManager.commit('editTimelineLayerParam', {
		sceneId: props.sceneId,
		layerId: selected.selection.layerId, target: selected.selection.target,
		paramPath: selected.selection.paramPath,
		edit: { kind: 'keyframesTimelineInline', value },
	}, mergeKey);
}

function updateKeyframeInterpolationType(keyframeId: string, type: KeyframeInterpolation['type']) {
	const current = selectedKeyframe.value?.binding.keyframesTimeline.keyframes.find(keyframe => keyframe.id === keyframeId)?.interpolation;
	if (current == null) return;
	const interpolation: KeyframeInterpolation = type === 'linear' || type === 'hold' ? { type }
		: { type, direction: 'direction' in current ? current.direction : 'inOut' };
	updateKeyframe(keyframeId, { interpolation });
}

function updateKeyframeEasingDirection(keyframeId: string, direction: EasingDirection) {
	const interpolation = selectedKeyframe.value?.binding.keyframesTimeline.keyframes.find(keyframe => keyframe.id === keyframeId)?.interpolation;
	if (interpolation == null || !('direction' in interpolation)) return;
	updateKeyframe(keyframeId, { interpolation: { ...interpolation, direction } });
}

function updateKeyframeValue(value: unknown, mergeKey?: string | null) {
	const selected = selectedKeyframe.value;
	if (selected == null) return;
	updateKeyframe(selected.selection.keyframeId, { value }, mergeKey);
}

function updateKeyframeTime(value: string | number) {
	const selected = selectedKeyframe.value;
	const x = Number(value);
	if (selected == null || !Number.isFinite(x)) return;
	updateKeyframe(selected.selection.keyframeId, { x: Math.max(selected.minX, Math.min(selected.maxX, x)) });
}

// レイヤー名の欄を除いた描画幅に合わせ、主目盛りの間隔を約120pxを目安に選ぶ。
// ResizeObserverで更新される幅を使うことで、パネルのリサイズにも追従する。
// 刻み方に応じた丸めは目盛り生成側で行い、全体・ローカル・スナップの密度を揃える。
const xTicksCount = computed(() => getTimelineTickCount(tlElWidth.value));
const xTicks = computed(() => getTimelineTicks(tlPosX.value, tlRangeX.value, xTicksCount.value, tickMode.value));
const xMinorTicks = computed(() => getTimelineMinorTicks(xTicks.value, tickSubdivisions.value));
const xTicksWithMinor = computed(() => [...xTicks.value, ...xMinorTicks.value].toSorted((a, b) => a - b));
const clipTicksByLayer = computed(() => new Map(sceneLayers.value.map(layer => [layer.id,
																																																																																new Map(layer.clips.map(clip => [clip.id, getTimelineClipTicks(clip, tlPosX.value, tlRangeX.value, xTicksCount.value, tickMode.value, tickSubdivisions.value)])),
])));
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

function onTimelineWheel(ev: WheelEvent) {
	if (!ev.shiftKey || !(ev.target instanceof Element) || !ev.target.closest('[data-timeline-surface]')) return;
	// レイヤーやキーの上でも同じ操作にし、通常のスクロール・背景の二軸ズームとの二重処理を防ぐ。
	onXTicksWheel(ev);
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
	if (tlEl.value == null || tlElWidth.value <= 0) return;
	ev.preventDefault();
	ev.stopPropagation();

	const rect = tlEl.value.getBoundingClientRect();
	const x = ev.clientX - rect.left;
	// ShiftでdeltaXへ変換される環境と、行・ページ単位で届くホイールにも対応する。
	const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? tlElWidth.value : 1;
	const delta = (ev.deltaY || ev.deltaX) * unit;
	const viewport = zoomTimelineX(tlPosX.value, tlRangeX.value, Math.max(0, Math.min(1, x / tlElWidth.value)), delta);
	tlRangeX.value = viewport.range;
	tlPosX.value = viewport.start;
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
	return getLayerKeyframeParameters(appStateManager.state, layer).flatMap(({ target, paramPath, binding }) => {
		return binding.keyframesTimeline.keyframes.map(point => ({
			selection: { layerId: layer.id, target, paramPath, keyframeId: point.id },
			x: point.x, time: point.x, keyframes: binding.keyframesTimeline.keyframes,
		}));
	});
}));

// clips配列の差し替えはレイヤー配列やキー一覧を変更しない。最後のクリップを
// 削除した場合も選択を取り除き、続けてDeleteして存在しない対象を編集しない。
watch([sceneLayers, keyframeEntries, () => sceneLayers.value.flatMap(layer => layer.clips.map(clip => clipSelectionKey({ layerId: layer.id, clipId: clip.id })))], () => {
	const current = selection.value;
	if (current.kind === 'layers') {
		const ids = current.ids.filter(id => sceneLayers.value.some(layer => layer.id === id));
		if (ids.length !== current.ids.length) selection.value = { kind: 'layers', ids };
	} else if (current.kind === 'clips') {
		const clips = current.clips.filter(target => sceneLayers.value.some(layer => layer.id === target.layerId && layer.clips.some(clip => clip.id === target.clipId)));
		if (clips.length !== current.clips.length) selection.value = { kind: 'clips', clips };
	} else {
		const available = new Set(keyframeEntries.value.map(entry => keyframeSelectionKey(entry.selection)));
		const keyframes = current.keyframes.filter(point => available.has(keyframeSelectionKey(point)));
		if (keyframes.length !== current.keyframes.length) selection.value = { kind: 'keyframes', keyframes };
	}
}, { immediate: true });

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
	for (const element of layersEl.value.querySelectorAll<HTMLElement>('[data-timeline-clip-id]')) {
		const id = element.closest<HTMLElement>('[data-timeline-layer-id]')?.dataset.timelineLayerId;
		const rect = element.getBoundingClientRect();
		// 横方向のサイドバーに隠れる部分だけ除く。縦方向は、スクロールで画面外へ出た行も判定する。
		const visible = { left: Math.max(rect.left, viewport.left), right: Math.min(rect.right, viewport.right), top: rect.top, bottom: rect.bottom };
		const clipId = element.dataset.timelineClipId;
		if (id && clipId && visible.left <= visible.right && visible.top < visible.bottom) geometry.clips.push({ selection: { layerId: id, clipId }, rect: visible });
	}
	for (const element of layersEl.value.querySelectorAll<HTMLElement>('[data-timeline-keyframe-id]')) {
		const layerId = element.closest<HTMLElement>('[data-timeline-layer-id]')?.dataset.timelineLayerId;
		const lane = element.closest<HTMLElement>('[data-parameter-target]');
		const target = lane?.dataset.parameterTarget;
		const encodedPath = lane?.dataset.paramPath;
		const keyframeId = element.dataset.timelineKeyframeId;
		if (!layerId || !encodedPath || !keyframeId || (target !== 'audio' && target !== 'module' && target !== 'compositing' && target !== 'effect')) continue;
		const paramPath = JSON.parse(encodedPath) as ParamPath;
		const rect = element.getBoundingClientRect();
		const x = (rect.left + rect.right) / 2;
		const y = (rect.top + rect.bottom) / 2;
		if (x < viewport.left || x > viewport.right) continue;
		geometry.keyframes.push({ selection: { layerId, target, paramPath, keyframeId }, x, y });
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
	if (target.closest('[data-timeline-clip-id], [data-timeline-keyframe-id], button, input, select, textarea, [draggable="true"]')) return;
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

function startSelectionMove(event: PointerEvent, points: TimelineMovePoint[], snapTimes: number[], apply: (delta: number, mergeKey: string) => boolean,
	getSnapLines = (delta: number) => getTimelineSnappingTimes(points, snapTimes, delta)) {
	const timeline = tlEl.value;
	if (points.length === 0 || timeline == null) return;
	event.preventDefault();
	timeline.focus({ preventScroll: true });
	const originTime = tlPosX.value + (event.clientX - timeline.getBoundingClientRect().left) * tlRangeX.value / tlElWidth.value;
	const mergeKey = genId();
	let moved = false;
	let previousDelta = 0;
	stopSelectionDrag = listenPointerDrag(event, current => {
		if (!moved && Math.abs(current.clientX - event.clientX) < 3) return;
		moved = true;
		movingSelection.value = true;
		suppressTimelineClick = true;
		// ドラッグ中にズームしても、開始時の画素倍率ではなく現在の時刻座標で追従する。
		const msPerPixel = tlRangeX.value / tlElWidth.value;
		const pointerTime = tlPosX.value + (current.clientX - timeline.getBoundingClientRect().left) * msPerPixel;
		const result = constrainTimelineMove(pointerTime - originTime, points, snapTimes, msPerPixel);
		snappingTimes.value = getSnapLines(result.delta);
		if (result.delta === previousDelta) return;
		if (!apply(result.delta, mergeKey)) { stopSelectionDrag?.(); return; }
		previousDelta = result.delta;
	}, () => {
		snappingTimes.value = [];
		movingSelection.value = false;
		stopSelectionDrag = undefined;
	});
}

function resolveClip(target: TimelineClipSelection) {
	const layer = sceneLayers.value.find(layer => layer.id === target.layerId);
	const clip = layer?.clips.find(clip => clip.id === target.clipId);
	return layer && clip ? { layer, clip, target } : null;
}

function selectClip(target: TimelineClipSelection, additive = false) {
	tlEl.value?.focus({ preventScroll: true });
	if (additive && selection.value.kind === 'clips') {
		const key = clipSelectionKey(target);
		const clips = selection.value.clips;
		selection.value = { kind: 'clips', clips: clips.some(clip => clipSelectionKey(clip) === key)
			? clips.filter(clip => clipSelectionKey(clip) !== key) : [...clips, target] };
	} else selection.value = { kind: 'clips', clips: [target] };
}

function onClipMoveStart(event: PointerEvent, target: TimelineClipSelection) {
	if (event.button !== 0 || !event.isPrimary || stopSelectionDrag || tlElWidth.value <= 0 || tlRangeX.value <= 0) return;
	if (event.shiftKey || event.ctrlKey || event.metaKey) { selectClip(target, true); return; }
	if (selection.value.kind !== 'clips' || !selection.value.clips.some(clip => clipSelectionKey(clip) === clipSelectionKey(target))) selectClip(target);
	if (selection.value.kind !== 'clips') return;
	const targets = deepClone(selection.value.clips);
	const entries = targets.map(resolveClip).filter(entry => entry != null);
	const points = entries.flatMap(({ layer, clip }) => {
		const bounds = getTimelineClipMoveBounds(layer.clips, new Set(targets.filter(target => target.layerId === layer.id).map(target => target.clipId)), clip.id);
		return getTimelineClipSnapPoints(clip, bounds, clipSnapSettings.value);
	});
	const selected = new Set(targets.map(clipSelectionKey));
	const snapTimes = getTimelineSnapCandidates(snapSettings.value, [0, ...sceneLayers.value.flatMap(layer => layer.clips
		.filter(clip => !selected.has(clipSelectionKey({ layerId: layer.id, clipId: clip.id })))
		.flatMap(clip => [clip.startMs, getTimelineClipEnd(clip)]))], xTicksWithMinor.value, [], time.value);
	const initialTargets = entries.map(({ target, clip }) => ({ ...target, initialStartMs: clip.startMs }));
	startSelectionMove(event, points, snapTimes, (delta, mergeKey) => {
		if (targets.some(target => !resolveClip(target))) return false;
		appStateManager.commit('moveTimelineClips', { sceneId: props.sceneId, clips: initialTargets, deltaMs: delta }, mergeKey);
		return true;
	});
}

function onClipTrimStart(event: PointerEvent, target: TimelineClipSelection, edge: 'start' | 'end') {
	if (event.button !== 0 || !event.isPrimary || stopSelectionDrag || tlElWidth.value <= 0 || tlRangeX.value <= 0) return;
	const entry = resolveClip(target);
	if (!entry) return;
	selectClip(target);
	const { layer, clip } = entry;
	const media = layer.layerType === 'audio' || layer.layerType === 'video';
	const sourceDurationMs = 'assetId' in clip && typeof clip.assetId === 'string' ? mediaInfo.value.get(clip.assetId)?.durationMs : undefined;
	if (media && sourceDurationMs == null) return;
	const bounds = getTimelineClipTrimBounds(layer.clips, clip.id, edge, media || layer.layerType === 'scene', sourceDurationMs);
	if (bounds.minDelta > bounds.maxDelta) return;
	const points = getTimelineClipSnapPoints(clip, bounds, clipSnapSettings.value, edge);
	const snapTimes = getTimelineSnapCandidates(snapSettings.value, [0, ...sceneLayers.value.flatMap(entry => entry.clips
		.filter(other => entry.id !== layer.id || other.id !== clip.id).flatMap(other => [other.startMs, getTimelineClipEnd(other)]))], xTicksWithMinor.value, [], time.value);
	const initialTiming = { startMs: clip.startMs, durationMs: clip.durationMs, contentOffsetMs: clip.contentOffsetMs };
	startSelectionMove(event, points, snapTimes, (delta, mergeKey) => {
		if (!resolveClip(target)) return false;
		appStateManager.commit('editTimelineClipTiming', { sceneId: props.sceneId, ...target, edge, deltaMs: delta, initialTiming, sourceDurationMs }, mergeKey);
		return true;
	});
}

function onKeyframeMoveStart(event: PointerEvent, point: TimelineKeyframeSelection) {
	if (event.button !== 0 || !event.isPrimary || stopSelectionDrag || tlElWidth.value <= 0 || tlRangeX.value <= 0) return;
	const key = keyframeSelectionKey(point);
	const stretchSelection = event.shiftKey ? getTimelineStretchSelection(keyframeEntries.value.map(entry => entry.selection), selection.value, point) : [];
	const stretchKeys = new Set(stretchSelection.map(keyframeSelectionKey));
	const stretchEntries = keyframeEntries.value.filter(entry => stretchKeys.has(keyframeSelectionKey(entry.selection)));
	const laneEntries = stretchEntries.filter(entry => entry.selection.target === point.target && paramPathKey(entry.selection.paramPath) === paramPathKey(point.paramPath));
	const stretch = event.shiftKey ? createKeyframeStretch(laneEntries.map(entry => ({ id: entry.selection.keyframeId, x: entry.x })), point.keyframeId,
		stretchEntries.map(entry => {
			const ids = new Set(stretchSelection.filter(point => point.target === entry.selection.target && paramPathKey(point.paramPath) === paramPathKey(entry.selection.paramPath)).map(point => point.keyframeId));
			return { x: entry.x, ...keyframeMoveBounds(entry.keyframes, ids, entry.selection.keyframeId) };
		})) : null;
	if (stretch != null) {
		// 同じレイヤーの選択済みキーを、ドラッグしたレーンの選択範囲を基準に変形する。
		selection.value = { kind: 'keyframes', keyframes: stretchSelection };
	} else if (selection.value.kind !== 'keyframes' || !selection.value.keyframes.some(entry => keyframeSelectionKey(entry) === key)) onKeyframeSelected(point);
	const current = selection.value;
	if (current.kind !== 'keyframes') return;
	const selected = new Set(current.keyframes.map(keyframeSelectionKey));
	const entries = keyframeEntries.value.filter(entry => selected.has(keyframeSelectionKey(entry.selection)));
	const otherTimes = [0, ...sceneLayers.value.flatMap(entry => entry.clips.flatMap(clip => [clip.startMs, getTimelineClipEnd(clip)])),
																					...keyframeEntries.value.filter(entry => !selected.has(keyframeSelectionKey(entry.selection))).map(entry => entry.time)];
	const candidatesByLayer = new Map(sceneLayers.value.map(layer => {
		// キーはScene時刻のまま、所属レイヤーの各クリップに描いた目盛りへ吸着させる。
		// 空白区間にはローカル目盛りがなく、別レイヤーのクリップも候補に含めない。
		const localTimes = [...(clipTicksByLayer.value.get(layer.id)?.values() ?? [])]
			.flatMap(ticks => [...ticks.major, ...ticks.minor].map(tick => tick.sceneTimeMs)).toSorted((a, b) => a - b);
		return [layer.id, getTimelineSnapCandidates(snapSettings.value, otherTimes, xTicksWithMinor.value, localTimes, time.value)];
	}));
	const points = entries.filter(entry => stretch == null || keyframeSelectionKey(entry.selection) === key).map(entry => {
		const ids = new Set(current.keyframes.filter(point => point.layerId === entry.selection.layerId && point.target === entry.selection.target && paramPathKey(point.paramPath) === paramPathKey(entry.selection.paramPath)).map(point => point.keyframeId));
		const bounds = stretch ?? keyframeMoveBounds(entry.keyframes, ids, entry.selection.keyframeId);
		return { time: entry.time, minDelta: bounds.minDelta, maxDelta: bounds.maxDelta, snapTimes: candidatesByLayer.get(entry.selection.layerId) ?? [] };
	});
	const positions = entries.map(entry => ({ ...entry.selection, x: entry.x }));
	const movedX = (x: number, delta: number) => Math.round(stretch == null ? x + delta : stretchKeyframeX(x, stretch, delta));
	startSelectionMove(event, points, [], (delta, mergeKey) => {
		const available = new Set(keyframeEntries.value.map(entry => keyframeSelectionKey(entry.selection)));
		if (positions.some(position => !available.has(keyframeSelectionKey(position)))) return false;
		appStateManager.commit('moveTimelineKeyframes', { sceneId: props.sceneId, positions: positions.map(position => ({ ...position, x: movedX(position.x, delta) })) }, mergeKey);
		return true;
	}, delta => getTimelineSnappingTimes(entries.map(entry => ({
		time: entry.time + movedX(entry.x, delta) - entry.x,
		minDelta: 0, maxDelta: 0, snapTimes: candidatesByLayer.get(entry.selection.layerId) ?? [],
	})), [], 0));
}

onBeforeUnmount(() => stopSelectionDrag?.());

function onSeekBarPointerDown(ev: PointerEvent) {
	if (ev.button !== 0 || !ev.isPrimary || stopSelectionDrag || panning.value || tlEl.value == null || tlElWidth.value <= 0 || tlRangeX.value <= 0) return;
	ev.preventDefault();
	ev.stopPropagation();
	const timeline = tlEl.value;
	stopSelectionDrag = listenPointerDrag(ev, event => {
		const x = event.clientX - timeline.getBoundingClientRect().left;
		const candidates = snapSeekBar.value ? getTimelineSnapCandidates(snapSettings.value, [], xTicksWithMinor.value) : [];
		const result = getTimelineSeekPosition(domXToTime(x), duration.value, candidates, tlRangeX.value / tlElWidth.value);
		snappingTimes.value = result.snappingTime == null ? [] : [result.snappingTime];
		previewPlayback.seekTimeline(result.timeMs);
	}, () => {
		snappingTimes.value = [];
		stopSelectionDrag = undefined;
	});
}

async function onTlKeydown(ev: KeyboardEvent) {
	if (ev.defaultPrevented) return;
	const target = ev.target;
	if (target instanceof HTMLElement && (target.closest('input, textarea, select') || target.isContentEditable)) return;
	const key = ev.key.toLowerCase();
	if ((key === 'delete' || key === 'backspace') && selection.value.kind === 'clips') { ev.preventDefault(); ev.stopPropagation(); removeSelectedClips(); return; }
	if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return;
	if (selection.value.kind === 'clips') {
		if (key === 'c' || key === 'v') { ev.preventDefault(); ev.stopPropagation(); }
		return;
	}
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
		// レイヤー全体の複製ではScene上のキーと全クリップの位置関係をそのまま保持する。
		for (const clip of layer.clips) clip.id = genId();
		try {
			const sourceLayerId = timelineLayerClipboard.layer.id;
			const scene = sceneLayers.value;
			const sourceDurationsMs = await readLayerMediaDurations(layer);
			if (disposed || sceneLayers.value !== scene) return;
			appStateManager.commit('pasteTimelineLayer', { sceneId: props.sceneId, layer, sourceLayerId, sourceDurationsMs });
		} catch (error) {
			void ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
			return;
		}
		selectLayer(layer);
	}
}

function selectLayer(layer: TimelineLayer, event?: MouseEvent) {
	if (event && (event.shiftKey || event.ctrlKey || event.metaKey) && selection.value.kind === 'layers') {
		const ids = selection.value.ids;
		selection.value = { kind: 'layers', ids: ids.includes(layer.id) ? ids.filter(id => id !== layer.id) : [...ids, layer.id] };
	} else selection.value = { kind: 'layers', ids: [layer.id] };
	tlEl.value?.focus({ preventScroll: true });
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
	sceneEditorStates.set(editedScene, { selection: deepClone(selection.value), rangeX: tlRangeX.value, positionX: tlPosX.value });
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

function onTimelineLayerParamEdit(event: ParamEdit, target: TimelineParameterTarget) {
	const layer = selectedLayer.value;
	if (layer == null || event.kind === 'node' || event.kind === 'externalCustomParameterInput') return;
	if (event.kind === 'inputSource' && (event.inputSource === 'node' || event.inputSource === 'externalCustomParameterInput')) return;
	const mergeKey = event.mergeKey != null ? JSON.stringify([layer.id, target, event.paramPath, event.mergeKey]) : undefined;
	if (event.kind === 'layerInput' || (event.kind === 'inputSource' && event.inputSource === 'layerInput')) {
		if (target !== 'effect') return;
		appStateManager.commit('editTimelineLayerParam', {
			sceneId: props.sceneId, layerId: layer.id, target, paramPath: event.paramPath, edit: event,
		}, mergeKey);
		return;
	}
	appStateManager.commit('editTimelineLayerParam', {
		sceneId: props.sceneId, layerId: layer.id, target, paramPath: event.paramPath, edit: event,
	}, mergeKey);
}

const audioError = ref<string | null>(null);
const mediaInfo = shallowRef<ReadonlyMap<string, TimelineClipMediaInfo>>(new Map());
const mediaAssets = computed(() => {
	const ids = new Set(sceneLayers.value.flatMap(layer => layer.layerType === 'video' || layer.layerType === 'audio' ? layer.clips.map(clip => clip.assetId) : []));
	return appStateManager.state.assets.value.filter(asset => ids.has(asset.id));
});
watch(() => mediaAssets.value.map(asset => ({ asset, blob: asset.fileData })), async (entries, _, onCleanup) => {
	let cancelled = false;
	onCleanup(() => { cancelled = true; });
	mediaInfo.value = new Map();
	const result = new Map<string, TimelineClipMediaInfo>();
	await Promise.all(entries.map(async ({ asset }) => {
		try { result.set(asset.id, await inspectTimelineClipMedia(asset)); } catch (error) { if (!cancelled) audioError.value = error instanceof Error ? error.message : String(error); }
	}));
	if (!cancelled) mediaInfo.value = result;
}, { immediate: true });

const selectedClipEntry = computed(() => selection.value.kind === 'clips' && selection.value.clips.length === 1 ? resolveClip(selection.value.clips[0]) : null);
const selectedClipNeedsMedia = computed(() => selectedClipEntry.value?.layer.layerType === 'audio' || selectedClipEntry.value?.layer.layerType === 'video');
const selectedClipMedia = computed(() => {
	const clip = selectedClipEntry.value?.clip;
	return clip && 'assetId' in clip && typeof clip.assetId === 'string' ? mediaInfo.value.get(clip.assetId) : undefined;
});
const selectedVideoClip = computed(() => {
	const entry = selectedClipEntry.value;
	return entry?.layer.layerType === 'video' ? entry.layer.clips.find(clip => clip.id === entry.clip.id) : null;
});
const selectedSceneClip = computed(() => {
	const entry = selectedClipEntry.value;
	return entry?.layer.layerType === 'scene' ? entry.layer.clips.find(clip => clip.id === entry.clip.id) : null;
});
const selectedClipLabel = computed(() => {
	const entry = selectedClipEntry.value;
	if (!entry) return '';
	if ('assetId' in entry.clip) { const id = entry.clip.assetId; return appStateManager.state.assets.value.find(asset => asset.id === id)?.name ?? 'Missing media'; }
	if ('sceneId' in entry.clip) { const id = entry.clip.sceneId; return appStateManager.state.timelineScenes.value.find(scene => scene.id === id)?.name ?? 'Missing scene'; }
	if (entry.layer.layerType === 'visualModule') { const id = entry.layer.visualModuleId; return appStateManager.state.visualModules.value.find(module => module.id === id)?.name ?? 'Missing module'; }
	if (entry.layer.layerType === 'inlineVisualModule') return 'Inline Visual Module';
	if (entry.layer.layerType === 'effect') { const id = entry.layer.effectId; return Object.entries(effectDefinitions).find(([key, effect]) => key === id)?.[1].displayName ?? 'Missing effect'; }
	return '?';
});

function removeSelectedClips() {
	if (selection.value.kind !== 'clips' || selection.value.clips.length === 0) return;
	appStateManager.commit('removeTimelineClips', { sceneId: props.sceneId, clips: deepClone(selection.value.clips) });
}

function editSelectedClipTime(kind: 'move' | 'start' | 'duration', value: string | number) {
	const entry = selectedClipEntry.value;
	const next = Number(value);
	if (!entry || !Number.isFinite(next)) return;
	if (kind === 'move') appStateManager.commit('moveTimelineClips', { sceneId: props.sceneId, clips: [entry.target], deltaMs: next - entry.clip.startMs });
	else {
		if (selectedClipNeedsMedia.value && !selectedClipMedia.value) return;
		appStateManager.commit('editTimelineClipTiming', {
			sceneId: props.sceneId, ...entry.target,
			edge: kind === 'start' ? 'start' : 'end',
			deltaMs: kind === 'start' ? next - entry.clip.startMs : next - entry.clip.durationMs,
			sourceDurationMs: selectedClipMedia.value?.durationMs,
		});
	}
}

function editSelectedClipAudio(audioEnabled: boolean) {
	const entry = selectedClipEntry.value;
	if (!entry || !selectedVideoClip.value) return;
	appStateManager.commit('editVideoClipAudio', { sceneId: props.sceneId, ...entry.target, audioEnabled });
}

type ClipSource = { kind: 'asset'; asset: Asset; media?: TimelineClipMediaInfo } | { kind: 'scene'; scene: TimelineScene };

async function chooseClipSource(layerType: 'image' | 'video' | 'audio' | 'scene'): Promise<ClipSource | null> {
	const scene = sceneLayers.value;
	const assets = appStateManager.state.assets.value;
	if (layerType === 'scene') {
		const { canceled, result: id } = await ui.select({ title: 'Select Scene', items: availableScenes.value.map(scene => ({ label: scene.name, value: scene.id })) });
		const selected = availableScenes.value.find(scene => scene.id === id);
		return canceled || !selected || disposed || sceneLayers.value !== scene ? null : { kind: 'scene', scene: selected };
	}
	const { canceled, result: id } = await ui.select({
		title: 'Select ' + layerType + ' asset',
		items: assets.filter(asset => asset.fileDataType.startsWith(layerType + '/')).map(asset => ({ label: asset.name, value: asset.id })),
	});
	const asset = assets.find(asset => asset.id === id);
	if (canceled || !asset || disposed || sceneLayers.value !== scene || appStateManager.state.assets.value !== assets) return null;
	const blob = asset.fileData;
	try {
		const media = layerType === 'image' ? undefined : await inspectTimelineClipMedia(asset);
		if (disposed || sceneLayers.value !== scene || !appStateManager.state.assets.value.includes(asset) || asset.fileData !== blob) return null;
		if (media?.audioError) {
			const result = await ui.confirm({ type: 'warning', title: asset.name, text: media.audioError, okText: 'Add without audio' });
			if (result.canceled || disposed || sceneLayers.value !== scene || !appStateManager.state.assets.value.includes(asset) || asset.fileData !== blob) return null;
		}
		return { kind: 'asset', asset, media };
	} catch (error) { audioError.value = error instanceof Error ? error.message : String(error); return null; }
}

async function addClip(layer: TimelineLayer, startMs: number) {
	startMs = Math.round(startMs);
	if (getTimelineClipInsertionDuration(layer.clips, startMs) <= 0) return;
	const type = layer.layerType;
	const source = type === 'image' || type === 'video' || type === 'audio' || type === 'scene' ? await chooseClipSource(type) : null;
	if (disposed || !sceneLayers.value.includes(layer)) return;
	if ((type === 'image' || type === 'video' || type === 'audio' || type === 'scene') && !source) return;
	// ピッカー待機中にも他のクリップが動くので、追加直前の空きを使う。
	const sourceDurationMs = source?.kind === 'asset' ? source.media?.durationMs : undefined;
	const durationMs = getTimelineClipInsertionDuration(layer.clips, startMs, Math.min(5000, sourceDurationMs ?? Infinity));
	if (durationMs <= 0) return;
	const clip = {
		id: genId(),
		...createTimelineClipTiming(startMs, durationMs),
		...(source?.kind === 'scene' ? { sceneId: source.scene.id } : source?.kind === 'asset' ? { assetId: source.asset.id } : {}),
		...(type === 'video' ? { audioEnabled: source?.kind === 'asset' && !!source.media?.audioAvailable } : {}),
	};
	try {
		appStateManager.commit('addTimelineClip', { sceneId: props.sceneId, layerId: layer.id, clip, sourceDurationMs });
		selectClip({ layerId: layer.id, clipId: clip.id });
	} catch (error) { audioError.value = error instanceof Error ? error.message : String(error); }
}

async function changeClipSource() {
	const entry = selectedClipEntry.value;
	if (!entry) return;
	const type = entry.layer.layerType;
	if (type !== 'image' && type !== 'video' && type !== 'audio' && type !== 'scene') return;
	const source = await chooseClipSource(type);
	if (!source || disposed || resolveClip(entry.target)?.clip !== entry.clip) return;
	if (source.kind === 'asset' && 'assetId' in entry.clip && entry.clip.assetId === source.asset.id) return;
	if (source.kind === 'scene' && 'sceneId' in entry.clip && entry.clip.sceneId === source.scene.id) return;
	try {
		appStateManager.commit('changeTimelineClipSource', {
			sceneId: props.sceneId,
			...entry.target,
			...(source.kind === 'scene' ? {
				referencedSceneId: source.scene.id,
			} : {
				assetId: source.asset.id, sourceDurationMs: source.media?.durationMs,
				audioEnabled: !!source.media?.audioAvailable && (!('audioEnabled' in entry.clip) || entry.clip.audioEnabled === true),
			}),
		});
	} catch (error) { audioError.value = error instanceof Error ? error.message : String(error); }
}

async function readLayerMediaDurations(layer: TimelineLayer): Promise<Record<string, number> | undefined> {
	if (layer.layerType !== 'audio' && layer.layerType !== 'video') return undefined;
	const sources = layer.clips.map(clip => {
		const asset = appStateManager.state.assets.value.find(asset => asset.id === clip.assetId);
		if (!asset) throw new Error('Missing media');
		return { clipId: clip.id, asset, blob: asset.fileData };
	});
	const durations = await Promise.all(sources.map(async ({ clipId, asset }) => [clipId, (await inspectTimelineClipMedia(asset)).durationMs] as const));
	if (sources.some(({ asset, blob }) => !appStateManager.state.assets.value.includes(asset) || asset.fileData !== blob)) throw new Error('Media changed during loading');
	return Object.fromEntries(durations);
}

function initialCompositingParameters() {
	return deepClone(Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, def.defaultValue]))) as import('@gs/subsystems_timeline_shared/types.ts').TimelineImageLayer['compositingParamValues'];
}

async function addMediaLayer(layerType: 'image' | 'video' | 'audio' | 'scene') {
	const source = await chooseClipSource(layerType);
	if (!source || disposed) return;
	const sourceDurationMs = source.kind === 'asset' ? source.media?.durationMs : undefined;
	const clip = { id: genId(), ...createTimelineClipTiming(Math.max(0, time.value), Math.min(5000, sourceDurationMs ?? Infinity)) };
	if (clip.durationMs < 1) { audioError.value = 'Media is shorter than 1 ms.'; return; }
	const base = { id: genId(), name: source.kind === 'asset' ? source.asset.name : source.scene.name, automationGraphs: [] };
	const audioParamValues = { volume: deepClone(timelineAudioParamDefs.volume.defaultValue) };
	const compositingParamValues = initialCompositingParameters();
	let layer: TimelineLayer;
	if (layerType === 'scene' && source.kind === 'scene') layer = { ...base, layerType, clips: [{ ...clip, sceneId: source.scene.id }], audioParamValues, compositingParamValues };
	else if (source.kind === 'asset' && layerType === 'image') layer = { ...base, layerType, clips: [{ ...clip, assetId: source.asset.id }], compositingParamValues };
	else if (source.kind === 'asset' && layerType === 'audio') layer = { ...base, layerType, clips: [{ ...clip, assetId: source.asset.id }], audioParamValues };
	else if (source.kind === 'asset' && layerType === 'video') layer = { ...base, layerType, clips: [{ ...clip, assetId: source.asset.id, audioEnabled: !!source.media?.audioAvailable }], audioParamValues, compositingParamValues };
	else return;
	appStateManager.commit('addTimelineLayer', { sceneId: props.sceneId, layer, sourceDurationsMs: sourceDurationMs == null ? undefined : { [clip.id]: sourceDurationMs } });
	selectClip({ layerId: layer.id, clipId: clip.id });
}

async function addReferencedModuleLayer() {
	const scene = sceneLayers.value;
	const { canceled, result: id } = await ui.select({ title: 'Select Visual Module', items: appStateManager.state.visualModules.value.map(module => ({ label: module.name, value: module.id })) });
	const module = appStateManager.state.visualModules.value.find(module => module.id === id);
	if (canceled || !module || disposed || sceneLayers.value !== scene) return;
	const layer: TimelineLayer = {
		id: genId(), name: module.name,
		layerType: 'visualModule',
		visualModuleId: module.id,
		clips: [{ id: genId(), ...createTimelineClipTiming(Math.max(0, time.value), 5000) }],
		visualModuleParamValues: {}, compositingParamValues: initialCompositingParameters(), automationGraphs: [],
	};
	appStateManager.commit('addTimelineLayer', { sceneId: props.sceneId, layer });
	selectLayer(layer);
}

function play() {
	previewPlayback.playTimeline();
}

function pause() {
	previewPlayback.pauseTimeline();
}

function showAddEffectLayerMenu() {
	const sceneId = props.sceneId;
	const startMs = Math.max(0, time.value);
	disposeEffectPicker?.();
	const { dispose } = ui.popup(GsEffectPicker, {}, {
		chosen: definition => {
			if (props.sceneId !== sceneId) return;
			const layer = createEffectTimelineLayer(definition, startMs);
			appStateManager.commit('addTimelineLayer', { sceneId, layer });
			selectLayer(layer);
			previewPlayback.seekTimeline(layer.clips[0].startMs);
		},
		closed: () => { dispose(); if (disposeEffectPicker === dispose) disposeEffectPicker = undefined; },
	});
	disposeEffectPicker = dispose;
}

function showAddLayerMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: 'Effect',
		icon: 'ti ti-sparkles',
		action: showAddEffectLayerMenu,
	}, {
		text: 'Image',
		icon: 'ti ti-photo',
		action: () => addMediaLayer('image'),
	}, {
		text: 'Video',
		icon: 'ti ti-video',
		action: () => addMediaLayer('video'),
	}, {
		text: 'Audio',
		icon: 'ti ti-music',
		action: () => addMediaLayer('audio'),
	}, {
		text: 'Visual Module (Inline)',
		icon: 'ti ti-chart-dots-3',
		action: () => {
			const layer = createInlineVisualModuleLayer(Math.max(0, time.value));
			appStateManager.commit('addTimelineLayer', { sceneId: props.sceneId, layer });
			selectLayer(layer);
			previewPlayback.seekTimeline(layer.clips[0].startMs);
		},
	}, {
		text: 'Visual Module (Reference)',
		icon: 'ti ti-chart-dots-3',
		action: addReferencedModuleLayer,
	}, {
		text: 'Scene',
		icon: 'ti ti-timeline',
		action: () => addMediaLayer('scene'),
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
.xMinorTick {
	position: absolute;
	bottom: 0;
	height: 5px;
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
	touch-action: none;
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
