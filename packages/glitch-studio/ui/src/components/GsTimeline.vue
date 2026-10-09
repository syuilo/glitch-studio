<template>
<div :class="$style.root" @keydown="onTlKeydown">
	<div :class="$style.header">
		<div :class="$style.headerLeft">
			<slot></slot>
		</div>
		<div :class="$style.headerCenter" style="gap: 20px;">
			<GsButton small :primary="previewPlayback.state.value.mode === 'timeline'" @click="previewPlayback.showTimeline()">Preview</GsButton>
			<GsButton v-tooltip="'CUE [C]'" small :primary="cueActive" :class="$style.cueButton" @pointerdown="onCuePointerDown" @keydown="onCueButtonKeydown" @click.prevent><i class="ti ti-arrow-right-bar"></i></GsButton>
			<div style="display: flex; gap: 4px;">
				<GsButton v-tooltip="'Go to Start'" small iconOnly @click="seek(0)"><i class="ti ti-player-skip-back"></i></GsButton>
				<!--<GsButton v-tooltip="'Back 10 Seconds'" small iconOnly @click="seek(time - 10000)"><i class="ti ti-rewind-backward-10"></i></GsButton>-->
				<GsButton v-tooltip="'Back 5 Seconds'" small iconOnly @click="seek(time - 5000)"><i class="ti ti-rewind-backward-5"></i></GsButton>
				<GsButton v-if="previewPlayback.isTimelinePlaying.value" v-tooltip="'PAUSE [SPACE]'" small primary @click="pause"><i class="ti ti-player-pause"></i></GsButton>
				<GsButton v-else v-tooltip="'PLAY [SPACE]'" small @click="play"><i class="ti ti-player-play"></i></GsButton>
				<GsButton v-tooltip="'Forward 5 Seconds'" small iconOnly @click="seek(time + 5000)"><i class="ti ti-rewind-forward-5"></i></GsButton>
				<!--<GsButton v-tooltip="'Forward 10 Seconds'" small iconOnly @click="seek(time + 10000)"><i class="ti ti-rewind-forward-10"></i></GsButton>-->
			</div>
			<div style="display: flex; gap: 4px;">
			</div>
		</div>
		<div :class="$style.headerCenter">
			<GsButton v-tooltip="'Prev Frame'" small iconOnly @click="stepFrame(-1)"><i class="ti ti-chevron-left"></i></GsButton>
			<GsButton v-tooltip="'Next Frame'" small iconOnly @click="stepFrame(1)"><i class="ti ti-chevron-right"></i></GsButton>
			<GsButton v-tooltip="'Prev Keyframe'" small iconOnly @click="seekToKeyframe(getPreviousKeyframeTime())"><i class="ti ti-keyframe"></i><i class="ti ti-chevron-left"></i></GsButton>
			<GsButton v-tooltip="'Next Keyframe'" small iconOnly @click="seekToKeyframe(getNextKeyframeTime())"><i class="ti ti-chevron-right"></i><i class="ti ti-keyframe"></i></GsButton>
		</div>
		<div :class="$style.headerCenter">
			<span v-if="timelineAudioPreview.buffering.value"><i class="ti ti-loader"></i></span>
			<span v-if="audioError || timelineAudioPreview.error.value || timelineRendererManagerController.errorMessage.value" v-tooltip="audioError || timelineAudioPreview.error.value || timelineRendererManagerController.errorMessage.value"><i class="ti ti-alert-triangle"></i></span>
		</div>
		<div :class="$style.headerRight">
			<GsButton small iconOnly><i class="ti ti-pointer"></i></GsButton>
			<GsButton small iconOnly><i class="ti ti-select-all"></i></GsButton>
			<GsButton small iconOnly><i class="ti ti-cut"></i></GsButton>
			<span>|</span>
			<GsButton v-tooltip="'Follow Playhead'" small iconOnly :primary="followPlayhead" @click="followPlayhead = !followPlayhead"><i class="ti ti-arrow-narrow-right-dashed"></i></GsButton>
			<GsButton v-tooltip="'Timeline Tick Settings...'" small iconOnly @click="showTickMenu"><i class="ti ti-ruler-2"></i></GsButton>
			<GsButton v-tooltip="'Snap Settings...'" small iconOnly :primary="snapEnabled" @click="showSnapMenu"><i class="ti ti-magnet"></i></GsButton>
		</div>
	</div>
	<div :class="$style.body" @contextmenu.stop.prevent @pointerdown.capture="onBackgroundPointerDown" @pointermove.capture="onTimelinePointerMove" @pointerleave="clearTimelineCursor" @click.capture="onTimelineClick" @mousedown.capture="onPanMousedown" @auxclick.capture="onPanAuxclick" @wheel.capture="onTimelineWheel">
		<div :class="$style.tlBgWrapper" data-timeline-surface>
			<div :class="$style.tlBgSideSpacer"></div>
			<div ref="tlEl" :class="$style.tlBg" tabindex="-1" @wheel="onTlWheel">
				<div :class="$style.ticksCorner"></div>
				<div :class="$style.tlRange" :style="{ width: tlRangeElWidth + 'px', left: tlRangeElPosX + 'px' }"></div>
				<div v-for="time of xTicks" :class="[$style.inTlXTick]" :style="{ left: timeToDomX(time) + 'px' }"></div>
			</div>
		</div>
		<div ref="layersEl" :class="$style.layers" data-timeline-surface>
			<div style="direction: ltr;">
				<!--
				<div :class="$style.layersHeader">
					<span class="_monospace">{{ formatFullTimecode(time) }}</span>
				</div>
				-->
				<div :class="$style.layersActions">
					<GsButton v-tooltip="'Add Layer'" small iconOnly @click="showAddLayerMenu"><i class="ti ti-plus"></i></GsButton>
					<GsButton v-tooltip="'Group'" iconOnly small :disabled="!canGroupSelection" @click="groupSelection"><i class="ti ti-folder-symlink"></i></GsButton>
					<GsButton v-if="selectedLayer?.layerType === 'group'" v-tooltip="'Ungroup'" iconOnly small @click="ungroupSelection"><i class="ti ti-folder-open"></i></GsButton>
					<GsButton v-if="selectedLayer && (layerAncestors.get(selectedLayer.id)?.length ?? 0) > 0" small @click="moveSelectedLayerOut">Move out</GsButton>
				</div>
			</div>
			<GsVirtualScroll
				:key="sceneId" ref="virtualLayers" :items="visibleLayers" :itemKey="getLayerKey" :itemSizeKey="getLayerSizeKey"
				:scrollElement="layersEl" :estimatedItemHeight="44" :gap="0" :overscan="0"
				:keepMountedKeys="draggingLayerId ? [draggingLayerId] : []" @layout="onVirtualLayersLayout"
			>
				<template #default="{ item: layer }">
					<XLayer
						:tlPosX="tlPosX"
						:optimizeHorizontalMovement="optimizeHorizontalMovement"
						:layer="layer"
						:sceneId="sceneId"
						:sceneTimeMs="time"
						:tlElWidth="tlElWidth"
						:tlRangeX="tlRangeX"
						:tickMode="tickMode"
						:tickSubdivisions="tickSubdivisions"
						:mediaInfo="mediaInfo"
						:selectedClipIds="selectedClipIdsByLayer.get(layer.id) ?? emptySelectionIds"
						:selectedKeyframes="selectedTimelineKeyframes"
						:class="[$style.layersLane, dropTarget?.layerId === layer.id ? $style['drop_' + dropTarget.position] : null]"
						:depth="layerAncestors.get(layer.id)?.length ?? 0"
						:isLastOfGroup="layerAncestors.get(layer.id)?.at(-1)?.layers.at(-1)?.id === layer.id"
						:ancestorDisabled="layerAncestors.get(layer.id)?.some(group => group.isDisabled) ?? false"
						:collapsed="!expandedLayers.has(layer.id)"
						:selected="selection.kind === 'layers' && selection.ids.includes(layer.id)"
						:moving="movingSelection"
						@toggleCollapse="toggleLayerExpansion(layer.id)"
						@groupMoveStart="event => onGroupMoveStart(event, layer)"
						@dragover="onLayerDragOver($event, layer)"
						@drop="onLayerDrop"
						@dragend="onLayerDragEnd"
						@dragStart="event => onLayerDragStart(event, layer)"
						@selected="event => selectLayer(layer, event)"
						@addClip="startMs => addClip(layer, startMs)"
						@look="center => tlPosX = center - tlRangeX / 2"
						@clipMoveStart="onClipMoveStart"
						@clipTrimStart="onClipTrimStart"
						@keyframeDragStart="onKeyframeMoveStart"
						@keyframeSelected="onKeyframeSelected"
						@subtitleTrimStart="onSubtitleTrimStart"
					/>
				</template>
			</GsVirtualScroll>
			<div>
				footer
			</div>
		</div>
		<div :class="$style.tlOverlayWrapper" data-timeline-surface>
			<div :class="$style.tlOverlaySideSpacer"></div>
			<div :class="$style.tlOverlay">
				<div :class="$style.xTicks" @pointerdown="onSeekBarPointerDown" @wheel="onXTicksWheel">
					<div v-for="time of xTicks" :class="$style.xTick" class="_monospace" :style="{ left: timeToDomX(time) + 'px' }">{{ formatMsToTimecode(time) }}</div>
					<div v-for="time of xMinorTicks" :class="$style.xMinorTick" :style="{ left: timeToDomX(time) + 'px' }"></div>
					<div :class="$style.xTicksSeekBar" :style="{ left: (seekBarPos - 1) + 'px' }" @pointerdown="onSeekBarPointerDown"></div>
				</div>
				<div :class="$style.ticksCorner"></div>
				<div v-if="selectionArea" :class="$style.selectedArea" :style="{ width: selectionArea.right - selectionArea.left + 'px', height: selectionArea.bottom - selectionArea.top + 'px', top: selectionArea.top + 'px', left: selectionArea.left + 'px' }"></div>
				<div v-for="time of xTicks" :class="[$style.inTlXTick]" :style="{ left: timeToDomX(time) + 'px' }"></div>
				<div :class="$style.seekBar" class="_monospace" :style="{ left: seekBarPos + 'px' }"><div :class="$style.seekBarFrame">{{ formatMsToTimecode(time, false) }}</div></div>
				<div v-if="cursorBarPos != null" :class="$style.cursorBar" :style="{ left: cursorBarPos + 'px' }"></div>
				<div v-for="snappingTime in snappingTimes" :key="snappingTime" :class="$style.snapLine" :style="{ left: timeToDomX(snappingTime) + 'px' }"></div>
			</div>
		</div>

		<Teleport v-if="props.subPanelTarget" defer :to="props.subPanelTarget">
			<GsTimelineInspector
				:scene="editedScene" :selection="selection" :mediaInfo="mediaInfo"
				@selectKeyframe="onKeyframeSelected" @removeKeyframes="removeSelectedKeyframes" @removeClips="removeSelectedClips"
				@changeClipSource="changeClipSource" @requestAddInlineEffectNode="showAddInlineEffectNodeMenu"
			/>
		</Teleport>
		<div v-else>
			<!-- TODO: GsWindowとかで表示する -->
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { flattenTimelineLayers, findTimelineLayer, findTimelineLayerLocation } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { getTimelineGroupRange } from '@gs/subsystems_timeline_shared/layers/group/group.ts';
import { createTimelineClipTiming, getTimelineClipEnd, getTimelineClipInsertionDuration, getTimelineClipTrimBounds } from '@gs/subsystems_timeline_shared/timing.ts';
import { computed, onBeforeUnmount, ref, shallowRef, toRef, useTemplateRef, watch } from 'vue';
import { genId } from '@gs/shared/utility/id.js';
import { timelineAudioParamDefs } from '@gs/subsystems_timeline_shared/timeline-audio.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { canReferenceScene } from '@gs/subsystems_timeline_shared/scenes.ts';
import { paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
import { shapeDefinitions } from '@gs/subsystems_timeline_shared/layers/shape/shape.ts';
import { createSpeechResolver } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import { assignPreparedSpeech, getVoicevoxUtterancePlacements } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox-placement.ts';
import XLayer from './GsTimeline.Layer.vue';
import GsTimelineInspector from './GsTimeline.Inspector.vue';
import GsButton from './common/GsButton.vue';
import GsVirtualScroll from './common/GsVirtualScroll.vue';
import GsEffectPicker from './GsEffectPicker.vue';
import type { TimelineMarqueeAnchor, TimelineLayerSelectionLayout } from '@/utility/timeline-marquee.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { TimelineGroupLayer, TimelineLayer, TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineClipSelection, TimelineKeyframeSelection, SelectionRect, TimelineMovePoint } from '@/utility/timeline-selection.ts';
import type { TimelineClipMediaInfo } from '@/utility/timeline-clip-media.ts';
import type { ShapeType } from '@gs/subsystems_timeline_shared/layers/shape/shape.ts';
import type { TimelineClipClipboard } from '@/utility/timeline-clip-clipboard.ts';
import type { TimelineClipSourceDurations } from '@/utility/timeline-clip-media.ts';
import { getTimelineKeyframeEditTarget } from '@/utility/timeline-keyframe-edit.ts';
import { createKeyframeStretch, stretchKeyframeX } from '@/utility/timeline-keyframe-stretch.ts';
import { useTimelineViewport } from '@/composables/useTimelineViewport.ts';
import { getTimelineVisibleClipTicks, formatTimelineTimecode as formatMsToTimecode } from '@/utility/timeline-ticks.ts';
import { getTimelineClipSnapPoints, getTimelineSnapCandidates, getTimelineSeekPosition } from '@/utility/timeline-snapping.ts';
import { preferences } from '@/preferences.ts';
import { listenPointerDrag } from '@/utility/pointer-drag.ts';
import { getTimelineKeyframeEntries, getTimelineKeyframeLanes } from '@/utility/timeline-keyframe-lanes.ts';
import { prepareTimelineClipMove } from '@/utility/timeline-clip-move.ts';
import { inspectTimelineClipMedia } from '@/utility/timeline-clip-media.ts';
import { selectTimelineLayer, selectionRect, mergeTimelineRangeSelection, clipSelectionKey, keyframeSelectionKey, getTimelineStretchSelection, constrainTimelineMove, keyframeMoveBounds, getTimelineSnappingTimes } from '@/utility/timeline-selection.ts';
import { createEffectTimelineLayer } from '@/utility/effect-timeline-layer.ts';
import { createShapeTimelineLayer } from '@/utility/shape-timeline-layer.ts';
import { createVoicevoxTimelineLayer } from '@/utility/voicevox-timeline-layer.ts';
import { getVoicevoxSubtitleTrimBounds } from '@/utility/voicevox-utterance-edit.ts';
import { prepareTimelineGroupMove, duplicateTimelineLayers } from '@/utility/timeline-group.ts';
import { createTextTimelineLayer } from '@/utility/text-timeline-layer.ts';
import { appContext } from '@/app.ts';
import { getTimelineEditorState, getSelectedTimelineLayerId, timelineClipboard } from '@/utility/timeline-editor-state.ts';
import { copyTimelineClips, prepareTimelineClipPaste, canPasteTimelineClips } from '@/utility/timeline-clip-clipboard.ts';
import { collectTimelineMarqueeCandidates, measureTimelineLayerSelection } from '@/utility/timeline-marquee.ts';
import { copyTimelineKeyframes, prepareTimelineKeyframePaste, getPastedTimelineKeySelection } from '@/utility/timeline-keyframe-clipboard.ts';
import * as ui from '@/ui.ts';
import { createInlineVisualModuleLayer } from '@/utility/inline-visual-module-layer.ts';

const { activeSceneId, previewPlayback, timelineAudioPreview, timelineRendererManagerController } = appContext;
const { stateManager } = appContext.projectContext;

const props = defineProps<{ sceneId: string; subPanelTarget?: HTMLElement | null }>();
const emit = defineEmits<{ revealDetails: [] }>();

// 選択を保持している間は監視しない。手動で閉じた詳細を、値の編集や再描画で開き直さないため。
function revealDetails() {
	if (selectedLayer.value != null) emit('revealDetails');
}

const followPlayhead = preferences.model('timelineFollowPlayhead');
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

const editedScene = stateManager.state.timelineScenes.value.find(scene => scene.id === props.sceneId)!;
const editorState = getTimelineEditorState(editedScene);
let disposed = false;
const rootLayers = computed(() => stateManager.state.timelineScenes.value.find(scene => scene.id === props.sceneId)?.layers ?? []);
const sceneLayers = computed(() => flattenTimelineLayers(rootLayers.value));
const clipLayers = computed(() => sceneLayers.value.filter(layer => layer.layerType !== 'group'));
// 展開したレイヤーだけを保持し、既存・新規レイヤーとも初期状態は折りたたみにする。
const expandedLayers = ref(new Set<string>());
const visibleLayers = computed(() => {
	const visit = (layers: TimelineLayer[]): TimelineLayer[] => layers.flatMap(layer => layer.layerType === 'group' && expandedLayers.value.has(layer.id) ? [layer, ...visit(layer.layers)] : [layer]);
	return visit(rootLayers.value);
});
const layerAncestors = computed(() => {
	const result = new Map<string, TimelineGroupLayer[]>();
	const visit = (layers: TimelineLayer[], ancestors: TimelineGroupLayer[]) => {
		for (const layer of layers) {
			result.set(layer.id, ancestors);
			if (layer.layerType === 'group') visit(layer.layers, [...ancestors, layer]);
		}
	};
	visit(rootLayers.value, []);
	return result;
});

function toggleLayerExpansion(id: string) {
	const next = new Set(expandedLayers.value);
	if (next.has(id)) next.delete(id); else next.add(id);
	expandedLayers.value = next;
}

const draggingLayerId = ref<string | null>(null);
const dropTarget = ref<{ layerId: string; parentId: string | null; beforeId: string | null; position: 'before' | 'after' | 'inside' } | null>(null);

function onLayerDragStart(event: DragEvent, layer: TimelineLayer) {
	draggingLayerId.value = layer.id;
	if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', layer.id); }
}

function onLayerDragOver(event: DragEvent, layer: TimelineLayer) {
	const source = draggingLayerId.value && findTimelineLayer(rootLayers.value, draggingLayerId.value);
	if (!source || findTimelineLayer([source], layer.id)) { dropTarget.value = null; return; }
	const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
	const fraction = (event.clientY - bounds.top) / bounds.height;
	const location = findTimelineLayerLocation(rootLayers.value, layer.id)!;
	const position = layer.layerType === 'group' && fraction >= 0.25 && fraction <= 0.75 ? 'inside' : fraction < 0.5 ? 'before' : 'after';
	dropTarget.value = {
		layerId: layer.id, position,
		parentId: position === 'inside' ? layer.id : location.ancestors.at(-1)?.id ?? null,
		beforeId: position === 'inside' && layer.layerType === 'group' ? layer.layers[0]?.id ?? null
		: position === 'before' ? layer.id : location.siblings[location.index + 1]?.id ?? null,
	};
	event.preventDefault();
	if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

function onLayerDrop(event: DragEvent) {
	event.preventDefault();
	if (draggingLayerId.value && dropTarget.value) stateManager.commit('moveTimelineLayer', {
		sceneId: props.sceneId, layerId: draggingLayerId.value, parentId: dropTarget.value.parentId, beforeId: dropTarget.value.beforeId,
	});
	onLayerDragEnd();
}

function onLayerDragEnd() { draggingLayerId.value = null; dropTarget.value = null; }

const availableScenes = computed(() => stateManager.state.timelineScenes.value.filter(scene => canReferenceScene(stateManager.state.timelineScenes.value, props.sceneId, scene.id)));

const X_TICKS_HEIGHT = 20;
const Y_TICKS_WIDTH = 0;

const duration = computed(() => clipLayers.value.reduce((max, layer) => layer.clips.reduce((end, clip) => Math.max(end, getTimelineClipEnd(clip)), max), 0));
const time = previewPlayback.currentTimelineTime;
const cueActive = ref(false);
let stopCueHold: (() => void) | undefined;

const tlEl = useTemplateRef('tlEl');
const layersEl = useTemplateRef('layersEl');
const virtualLayers = useTemplateRef('virtualLayers');
const marqueeLayers = computed(() => visibleLayers.value.map(layer => ({
	id: layer.id,
	clips: layer.layerType === 'group' ? [] : layer.clips,
	// 範囲選択は未描画の中間行も対象にするため、DOMだけでなく候補からも非表示のレーンを除く。
	lanes: layer.layerType !== 'group' && !expandedLayers.value.has(layer.id) ? [] : getTimelineKeyframeLanes(stateManager.state, layer),
})));
const layerSizeKeys = computed(() => new Map(marqueeLayers.value.map(layer => [layer.id, JSON.stringify(layer.lanes.map(lane => [lane.target, lane.paramPath]))])));

// 再生時刻が変わるたびに関数の同一性を変えると、仮想一覧の全件監視も毎フレーム再実行される。
function getLayerKey(layer: TimelineLayer) { return layer.id; }

function getLayerSizeKey(layer: TimelineLayer) { return layerSizeKeys.value.get(layer.id); }

// キャンセル関数自体を操作中の状態にし、開始前のしきい値判定や非同期の範囲選択も追従停止に含める。
const stopSelectionDrag = shallowRef<(() => void) | undefined>();
const {
	positionX: tlPosX, rangeX: tlRangeX, width: tlElWidth, height: tlElHeight, pixelsPerMs,
	panning, optimizeHorizontalMovement,
	tickCount: xTicksCount, ticks: xTicks, minorTicks: xMinorTicks, ticksWithMinor: xTicksWithMinor,
	timeToX: timeToDomX, timeAtX, timeAtClientX,
	onTimelineWheel, onBackgroundWheel: onTlWheel, onRulerWheel: onXTicksWheel, onPanMousedown, onPanAuxclick,
} = useTimelineViewport({
	timelineElement: tlEl, layersElement: layersEl, savedState: editorState,
	currentTime: time, isPlaying: previewPlayback.isTimelinePlaying, followPlayhead, tickMode, tickSubdivisions,
	interactionActive: computed(() => stopSelectionDrag.value != null),
});

const seekBarPos = computed(() => {
	return timeToDomX(time.value);
});
const cursorBarPos = ref<number | null>(null);
const snappingTimes = ref<number[]>([]);
const tlRangeElPosX = computed(() => {
	return timeToDomX(0);
});
const tlRangeElWidth = computed(() => {
	return duration.value * pixelsPerMs.value;
});
const tooltipDomPos = ref<null | [number, number]>(null);
const cursorTime = ref(0);
const cursorValue = ref(0);
const selectionArea = ref<SelectionRect | null>(null);
const movingSelection = ref(false);

const selection = toRef(editorState, 'selection');
// スクロールや縦仮想一覧の更新で同じ選択配列を作り直さない。
const emptySelectionIds: string[] = [];
const emptyKeyframeSelection: TimelineKeyframeSelection[] = [];
const selectedTimelineKeyframes = computed(() => selection.value.kind === 'keyframes' ? selection.value.keyframes : emptyKeyframeSelection);
const selectedClipIdsByLayer = computed(() => {
	const result = new Map<string, string[]>();
	if (selection.value.kind !== 'clips') return result;
	for (const clip of selection.value.clips) {
		const ids = result.get(clip.layerId) ?? [];
		ids.push(clip.clipId);
		result.set(clip.layerId, ids);
	}
	return result;
});
const selectionCount = computed(() => selection.value.kind === 'layers' ? selection.value.ids.length : selection.value.kind === 'clips' ? selection.value.clips.length : selection.value.keyframes.length);
const selectedLayerId = computed(() => selection.value.kind === 'layers' ? selection.value.ids[0] ?? null : selection.value.kind === 'clips' ? selection.value.clips[0]?.layerId ?? null : selection.value.keyframes[0]?.layerId ?? null);
const selectedLayer = computed(() => sceneLayers.value.find(layer => layer.id === getSelectedTimelineLayerId(selection.value)) ?? null);
const canGroupSelection = computed(() => {
	if (selection.value.kind !== 'layers' || !selection.value.ids.length) return false;
	const locations = selection.value.ids.map(id => findTimelineLayerLocation(rootLayers.value, id));
	const first = locations[0];
	if (!first || locations.some(location => !location || location.siblings !== first.siblings)) return false;
	const indexes = locations.map(location => location!.index).sort((a, b) => a - b);
	return indexes.every((index, offset) => index === indexes[0] + offset);
});

function addEmptyGroup() {
	const id = genId();
	stateManager.commit('groupTimelineLayers', { sceneId: props.sceneId, layerIds: [], group: {
		id, name: 'Group', layerType: 'group', layers: [], isDisabled: false, automationGraphs: [],
		compositingParamValues: initialCompositingParameters(), audioParamValues: { volume: deepClone(timelineAudioParamDefs.volume.defaultValue) },
	} });
	selection.value = { kind: 'layers', ids: [id] };
}

function groupSelection() {
	if (!canGroupSelection.value || selection.value.kind !== 'layers') return;
	const id = genId();
	stateManager.commit('groupTimelineLayers', { sceneId: props.sceneId, layerIds: [...selection.value.ids], group: {
		id, name: 'Group', layerType: 'group', layers: [], isDisabled: false, automationGraphs: [],
		compositingParamValues: initialCompositingParameters(), audioParamValues: { volume: deepClone(timelineAudioParamDefs.volume.defaultValue) },
	} });
	selection.value = { kind: 'layers', ids: [id] };
}

function ungroupSelection() {
	if (selectedLayer.value?.layerType !== 'group') return;
	const ids = selectedLayer.value.layers.map(layer => layer.id);
	stateManager.commit('ungroupTimelineLayer', { sceneId: props.sceneId, layerId: selectedLayer.value.id });
	selection.value = { kind: 'layers', ids };
}

function moveSelectedLayerOut() {
	if (!selectedLayer.value) return;
	const location = findTimelineLayerLocation(rootLayers.value, selectedLayer.value.id)!;
	const parent = location.ancestors.at(-1);
	if (parent) stateManager.commit('moveTimelineLayer', { sceneId: props.sceneId, layerId: selectedLayer.value.id,
																																																								parentId: location.ancestors.at(-2)?.id ?? null, beforeId: parent.id });
}

const selectedLayerKeyframeTimes = computed(() => {
	const layer = selectedLayer.value;
	if (layer == null) return [];
	return getTimelineKeyframeLanes(stateManager.state, layer)
		.flatMap(({ keyframes }) => keyframes.map(keyframe => keyframe.x))
		.sort((a, b) => a - b);
});
const getPreviousKeyframeTime = () => selectedLayerKeyframeTimes.value.findLast(keyframeTime => keyframeTime < time.value) ?? null;
const getNextKeyframeTime = () => selectedLayerKeyframeTimes.value.find(keyframeTime => keyframeTime > time.value) ?? null;

function seekToKeyframe(timeMs: number | null) {
	const layer = selectedLayer.value;
	if (timeMs == null || layer == null) return;
	const keyframes = keyframeEntries.value
		.filter(entry => entry.selection.layerId === layer.id && entry.time === timeMs)
		.map(entry => entry.selection);
	if (keyframes.length === 0) return;
	// 同時刻のキーに優先順位を付けず、移動先のレイヤー内のキーをまとめて選択する。
	selection.value = { kind: 'keyframes', keyframes };
	revealDetails();
	// キーはクリップの区間外にも置けるため、Sceneの長さで移動先を制限しない。
	previewPlayback.seekTimeline(timeMs);
	// 移動先のキーを確認できるよう、再生追従の設定によらずシークバーを中央に置く。
	tlPosX.value = timeMs - tlRangeX.value / 2;
}

const selectedKeyframeSelection = computed<TimelineKeyframeSelection | null>({
	get: () => selection.value.kind === 'keyframes' && selection.value.keyframes.length === 1 ? selection.value.keyframes[0] : null,
	set: point => { selection.value = point ? { kind: 'keyframes', keyframes: [point] } : { kind: 'layers', ids: selectedLayerId.value ? [selectedLayerId.value] : [] }; },
});
// 選択の整合性はInspectorの表示状態にかかわらず維持する。
const selectedKeyframe = computed(() => getTimelineKeyframeEditTarget(stateManager.state, selectedLayer.value, selectedKeyframeSelection.value));
watch(selectedKeyframe, value => {
	if (value == null && selectedKeyframeSelection.value != null && selectedKeyframeSelection.value.target !== 'utterance') selectedKeyframeSelection.value = null;
});

function removeSelectedKeyframes() {
	if (selection.value.kind !== 'keyframes' || selection.value.keyframes.length === 0) return;
	stateManager.commit('removeTimelineKeyframes', { sceneId: props.sceneId, keyframes: deepClone(selection.value.keyframes) });
	selection.value = { kind: 'layers', ids: selectedLayerId.value ? [selectedLayerId.value] : [] };
}

function onKeyframeSelected(selection: TimelineKeyframeSelection) {
	selectedKeyframeSelection.value = selection;
	revealDetails();
}

function clearTimelineCursor() {
	cursorBarPos.value = null;
	tooltipDomPos.value = null;
}

function onTimelinePointerMove(ev: PointerEvent) {
	if (tlEl.value == null) return;
	const rect = tlEl.value.getBoundingClientRect();
	const pointerX = ev.clientX - rect.left;
	const pointerY = ev.clientY - rect.top;
	if (pointerX < 0 || pointerX >= rect.width || pointerY < 0 || pointerY >= rect.height) {
		clearTimelineCursor();
		return;
	}

	// 背景の上にはレイヤー一覧と目盛りが重なるため、共通の親でcaptureして位置を追跡する。
	// ガイド線は時刻の整数msへの丸めを経由せず、拡大中もポインターの画素位置に合わせる。
	cursorBarPos.value = pointerX;
	cursorTime.value = Math.round(timeAtX(pointerX));
	tooltipDomPos.value = [pointerX + 10, pointerY + 10];
}

const keyframeEntries = computed(() => getTimelineKeyframeEntries(stateManager.state, sceneLayers.value));

// clips配列の差し替えはレイヤー配列やキー一覧を変更しない。最後のクリップを
// 削除した場合も選択を取り除き、続けてDeleteして存在しない対象を編集しない。
watch([sceneLayers, keyframeEntries, () => clipLayers.value.flatMap(layer => layer.clips.map(clip => clipSelectionKey({ layerId: layer.id, clipId: clip.id })))], () => {
	const current = selection.value;
	if (current.kind === 'layers') {
		const ids = current.ids.filter(id => sceneLayers.value.some(layer => layer.id === id));
		if (ids.length !== current.ids.length) selection.value = { kind: 'layers', ids };
	} else if (current.kind === 'clips') {
		const clips = current.clips.filter(target => clipLayers.value.some(layer => layer.id === target.layerId && layer.clips.some(clip => clip.id === target.clipId)));
		if (clips.length !== current.clips.length) selection.value = { kind: 'clips', clips };
	} else {
		const available = new Set(keyframeEntries.value.map(entry => keyframeSelectionKey(entry.selection)));
		const keyframes = current.keyframes.filter(point => available.has(keyframeSelectionKey(point)));
		if (keyframes.length !== current.keyframes.length) selection.value = { kind: 'keyframes', keyframes };
	}
}, { immediate: true });

let suppressTimelineClick = false;

function onTimelineClick(event: MouseEvent) {
	if (!suppressTimelineClick) return;
	suppressTimelineClick = false;
	event.preventDefault();
	event.stopPropagation();
}

let updateMarquee: (() => void) | undefined;
let cancelMarquee: (() => void) | undefined;

function onVirtualLayersLayout() { updateMarquee?.(); }

function onBackgroundPointerDown(event: PointerEvent) {
	suppressTimelineClick = false;
	if (event.button !== 0 || !event.isPrimary || stopSelectionDrag.value || panning.value || tlEl.value == null || layersEl.value == null || virtualLayers.value == null || !(event.target instanceof Element)) return;
	const timeline = tlEl.value;
	const layers = layersEl.value;
	const virtual = virtualLayers.value;
	const target = event.target;
	if (!layers.contains(target) && !timeline.contains(target)) return;
	if (target.closest('[data-timeline-clip-id], [data-timeline-keyframe-id], button, input, select, textarea, [draggable="true"]')) return;
	const bounds = timeline.getBoundingClientRect();
	if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top + X_TICKS_HEIGHT || event.clientY > bounds.bottom) return;
	event.preventDefault();
	event.stopPropagation();
	timeline.focus({ preventScroll: true });
	const previous = deepClone(selection.value);
	// ドラッグ開始を待たずに背景を押した時点で解除する。Shiftでの追加選択は維持する。
	if (!event.shiftKey) selection.value = { kind: 'layers', ids: [] };
	const originX = event.clientX - bounds.left;
	const initialY = event.clientY;
	let origin: TimelineMarqueeAnchor | undefined;
	let pointer = { x: event.clientX, y: event.clientY };
	const boundaryLayouts = new Map<string, TimelineLayerSelectionLayout>();
	let active = true;
	let finishing = false;
	let revision = 0;
	let pending: Promise<void> | undefined;

	function anchorAt(clientY: number): TimelineMarqueeAnchor | undefined {
		const y = clientY - virtual.getClientTop();
		const item = virtual.getItemAt(y);
		return item ? { layerId: String(item.key), offsetY: y - item.top } : undefined;
	}

	function measureBoundary(anchor: TimelineMarqueeAnchor): boolean {
		if (boundaryLayouts.has(anchor.layerId)) return true;
		const element = [...layers.querySelectorAll<HTMLElement>('[data-timeline-layer-id]')].find(element => element.dataset.timelineLayerId === anchor.layerId);
		if (!element) return false;
		const measured = measureTimelineLayerSelection(element);
		if (!measured) return false;
		boundaryLayouts.set(anchor.layerId, measured);
		return true;
	}

	// 開始時の行内位置を先に確保し、後続の実測による上方の高さ補正に影響されないようにする。
	const initialLayer = target.closest<HTMLElement>('[data-timeline-layer-id]');
	origin = initialLayer?.dataset.timelineLayerId
		? { layerId: initialLayer.dataset.timelineLayerId, offsetY: initialY - initialLayer.getBoundingClientRect().top }
		: anchorAt(initialY);
	if (origin && !measureBoundary(origin)) origin = undefined;

	function scheduleUpdate() {
		if (!active) return;
		revision++;
		if (pending) return;
		pending = (async () => {
			let processed = -1;
			while (active && processed !== revision) {
				processed = revision;
				// スクロールイベント時点では、新しい境界行のDOMがまだ存在しない場合がある。
				// 推定値で確定せず、仮想一覧が実測まで終えた後に判定する。
				await virtual.refresh();
				if (!active) break;
				const bounds = timeline.getBoundingClientRect();
				const endY = Math.max(bounds.top + X_TICKS_HEIGHT, Math.min(bounds.bottom, pointer.y));
				origin ??= anchorAt(initialY);
				const end = anchorAt(endY);
				if (!origin || !end || !measureBoundary(origin) || !measureBoundary(end)) continue;
				const originItem = virtual.getLayout().byKey.get(origin.layerId);
				if (!originItem) continue;
				const originY = virtual.getClientTop() + originItem.top + origin.offsetY;
				const endX = Math.max(0, Math.min(tlElWidth.value, pointer.x - bounds.left));
				const rect = selectionRect(originX, originY - bounds.top, endX, endY - bounds.top);
				if (!selectionArea.value && Math.hypot(rect.right - rect.left, rect.bottom - rect.top) < 3) continue;
				suppressTimelineClick = true;
				selectionArea.value = rect;
				const candidates = collectTimelineMarqueeCandidates(marqueeLayers.value, origin, end, boundaryLayouts, {
					left: rect.left, right: rect.right, position: tlPosX.value, range: tlRangeX.value, width: tlElWidth.value,
				});
				selection.value = mergeTimelineRangeSelection(candidates.clips, candidates.keyframes, previous, event.shiftKey);
				// 開始行と現在の境界以外のレーン座標は不要。高速スクロールでもメモリを増やさない。
				for (const id of boundaryLayouts.keys()) if (id !== origin.layerId && id !== end.layerId) boundaryLayouts.delete(id);
			}
		})().finally(() => { pending = undefined; if (finishing) cleanup(); });
	}

	function cleanup() {
		const reveal = active && finishing && selectionArea.value != null;
		active = false;
		layers.removeEventListener('scroll', scheduleUpdate);
		stopWatch();
		stopHorizontalWatch();
		// キャンセル後に次の操作が始まっていても、古い非同期計測の完了で消さない。
		if (updateMarquee === scheduleUpdate) {
			updateMarquee = undefined;
			cancelMarquee = undefined;
			selectionArea.value = null;
			stopSelectionDrag.value = undefined;
			// 範囲選択中の展開はタイムラインの寸法を変えるため、確定後に一度だけ開く。
			if (reveal) revealDetails();
		}
	}

	// レーン構成や並び順が変わる操作では古い行内計測を使わない。横ズームは再計算で追従する。
	const stopWatch = watch([
		() => props.sceneId,
		() => JSON.stringify([...layerSizeKeys.value]),
		tlElWidth,
		tlElHeight,
	], () => cancelMarquee?.(), { flush: 'sync' });
	const stopHorizontalWatch = watch([tlPosX, tlRangeX], scheduleUpdate);
	updateMarquee = scheduleUpdate;
	layers.addEventListener('scroll', scheduleUpdate, { passive: true });
	// 背景クリックは子レーンのダブルクリック追加へ届かせ、範囲選択の開始後だけ一覧で捕捉する。
	const stopPointer = listenPointerDrag(event, current => {
		pointer = { x: current.clientX, y: current.clientY };
		scheduleUpdate();
	}, () => {
		// pointerupで予約した最後の判定を待つ。行を破棄してもCaptureは一覧要素に残る。
		finishing = true;
		if (!pending) cleanup();
	}, layers, { captureAfterDistance: 3 });
	cancelMarquee = () => { active = false; stopPointer(); cleanup(); };
	stopSelectionDrag.value = cancelMarquee;
	scheduleUpdate();
}

function startSelectionMove(event: PointerEvent, points: TimelineMovePoint[], snapTimes: number[], apply: (delta: number, mergeKey: string) => boolean,
	getSnapLines = (delta: number) => getTimelineSnappingTimes(points, snapTimes, delta)) {
	const timeline = tlEl.value;
	const originTime = timeAtClientX(event.clientX);
	if (points.length === 0 || timeline == null || originTime == null) return;
	event.preventDefault();
	timeline.focus({ preventScroll: true });
	const mergeKey = genId();
	let moved = false;
	let previousDelta = 0;
	stopSelectionDrag.value = listenPointerDrag(event, current => {
		if (!moved && Math.abs(current.clientX - event.clientX) < 3) return;
		moved = true;
		movingSelection.value = true;
		suppressTimelineClick = true;
		// ドラッグ中にズームしても、開始時の画素倍率ではなく現在の時刻座標で追従する。
		const msPerPixel = 1 / pixelsPerMs.value;
		const pointerTime = timeAtClientX(current.clientX);
		if (pointerTime == null) return;
		const result = constrainTimelineMove(pointerTime - originTime, points, snapTimes, msPerPixel);
		snappingTimes.value = getSnapLines(result.delta);
		if (result.delta === previousDelta) return;
		if (!apply(result.delta, mergeKey)) { stopSelectionDrag.value?.(); return; }
		previousDelta = result.delta;
	}, () => {
		snappingTimes.value = [];
		movingSelection.value = false;
		stopSelectionDrag.value = undefined;
	}, layersEl.value ?? timeline);
}

function resolveClip(target: TimelineClipSelection) {
	const layer = clipLayers.value.find(layer => layer.id === target.layerId);
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
	revealDetails();
}

function onGroupMoveStart(event: PointerEvent, layer: TimelineLayer) {
	if (layer.layerType !== 'group' || event.button !== 0 || !event.isPrimary || stopSelectionDrag.value || tlElWidth.value <= 0 || tlRangeX.value <= 0) return;
	selectLayer(layer);
	const range = getTimelineGroupRange(layer);
	if (!range) return;
	const initial = prepareTimelineGroupMove(stateManager.state, layer);
	const points = getTimelineClipSnapPoints({ ...range, contentOffsetMs: 0 }, { minDelta: initial.minDelta, maxDelta: initial.maxDelta }, clipSnapSettings.value);
	const excluded = new Set(flattenTimelineLayers([layer]).map(child => child.id));
	const snapTimes = getTimelineSnapCandidates(snapSettings.value, [0, ...clipLayers.value.filter(child => !excluded.has(child.id))
		.flatMap(child => child.clips.flatMap(clip => [clip.startMs, getTimelineClipEnd(clip)]))], xTicksWithMinor.value, [], time.value);
	startSelectionMove(event, points, snapTimes, (delta, mergeKey) => {
		if (!findTimelineLayer(rootLayers.value, layer.id)) return false;
		stateManager.commit('moveTimelineGroup', { sceneId: props.sceneId, layerId: layer.id, deltaMs: delta, initial }, mergeKey);
		return true;
	});
}

function onClipMoveStart(event: PointerEvent, target: TimelineClipSelection) {
	if (event.button !== 0 || !event.isPrimary || stopSelectionDrag.value || tlElWidth.value <= 0 || tlRangeX.value <= 0) return;
	if (event.shiftKey || event.ctrlKey || event.metaKey) { selectClip(target, true); return; }
	if (selection.value.kind !== 'clips' || !selection.value.clips.some(clip => clipSelectionKey(clip) === clipSelectionKey(target))) selectClip(target);
	if (selection.value.kind !== 'clips') return;
	revealDetails();
	const targets = deepClone(selection.value.clips);
	const entries = targets.map(resolveClip).filter(entry => entry != null);
	const move = prepareTimelineClipMove(stateManager.state, editedScene, targets);
	const points = entries.flatMap(({ clip }) => getTimelineClipSnapPoints(clip,
		{ minDelta: move.minDelta, maxDelta: move.maxDelta }, clipSnapSettings.value));
	const selected = new Set(targets.map(clipSelectionKey));
	const snapTimes = getTimelineSnapCandidates(snapSettings.value, [0, ...clipLayers.value.flatMap(layer => layer.clips
		.filter(clip => !selected.has(clipSelectionKey({ layerId: layer.id, clipId: clip.id })))
		.flatMap(clip => [clip.startMs, getTimelineClipEnd(clip)]))], xTicksWithMinor.value, [], time.value);
	const initialTargets = entries.map(({ target, clip }) => ({ ...target, initialStartMs: clip.startMs }));
	startSelectionMove(event, points, snapTimes, (delta, mergeKey) => {
		if (targets.some(target => !resolveClip(target))) return false;
		stateManager.commit('moveTimelineClips', { sceneId: props.sceneId, clips: initialTargets, initialKeyframes: move.keyframes, deltaMs: delta }, mergeKey);
		return true;
	});
}

function onClipTrimStart(event: PointerEvent, target: TimelineClipSelection, edge: 'start' | 'end') {
	if (event.button !== 0 || !event.isPrimary || stopSelectionDrag.value || tlElWidth.value <= 0 || tlRangeX.value <= 0) return;
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
	const snapTimes = getTimelineSnapCandidates(snapSettings.value, [0, ...clipLayers.value.flatMap(entry => entry.clips
		.filter(other => entry.id !== layer.id || other.id !== clip.id).flatMap(other => [other.startMs, getTimelineClipEnd(other)]))], xTicksWithMinor.value, [], time.value);
	const initialTiming = { startMs: clip.startMs, durationMs: clip.durationMs, contentOffsetMs: clip.contentOffsetMs };
	startSelectionMove(event, points, snapTimes, (delta, mergeKey) => {
		if (!resolveClip(target)) return false;
		stateManager.commit('editTimelineClipTiming', { sceneId: props.sceneId, ...target, edge, deltaMs: delta, initialTiming, sourceDurationMs }, mergeKey);
		return true;
	});
}

function onSubtitleTrimStart(event: PointerEvent, layerId: string, utteranceId: string, clipId: string) {
	if (event.button !== 0 || !event.isPrimary || stopSelectionDrag.value || tlElWidth.value <= 0 || tlRangeX.value <= 0) return;
	const layer = sceneLayers.value.find(layer => layer.id === layerId);
	if (layer?.layerType !== 'voicevox') return;
	const bounds = getVoicevoxSubtitleTrimBounds(layer.voicevox, layer.utterances, layer.clips, utteranceId, clipId);
	if (!bounds) return;
	const utterance = layer.utterances.find(key => key.id === utteranceId)!;
	onKeyframeSelected({ layerId, target: 'utterance', paramPath: ['utterances'], keyframeId: utteranceId });
	const resolveSpeech = createSpeechResolver(stateManager.state.generatedSpeech.value);
	const audioEnds = getVoicevoxUtterancePlacements(layer.voicevox, layer.utterances, layer.clips).flatMap(placement => {
		const speech = resolveSpeech(placement.request);
		const interval = speech && assignPreparedSpeech(placement, speech);
		return interval ? [Math.round(interval.endMs)] : [];
	});
	const otherTimes = [0, ...clipLayers.value.flatMap(layer => layer.clips.flatMap(clip => [clip.startMs, getTimelineClipEnd(clip)])),
																					...keyframeEntries.value.map(entry => entry.time), ...audioEnds];
	const localTicks = snapSettings.value.localTicks ? getTimelineVisibleClipTicks(layer.clips, tlPosX.value, tlRangeX.value, xTicksCount.value, tickMode.value, tickSubdivisions.value)
		.flatMap(({ ticks }) => [...ticks.major, ...ticks.minor].map(tick => Math.round(tick.sceneTimeMs))) : [];
	const snapTimes = getTimelineSnapCandidates(snapSettings.value, otherTimes, xTicksWithMinor.value, localTicks, time.value);
	if (utterance.subtitleDuration.mode !== 'specified') return;
	const initialDuration = utterance.subtitleDuration.durationMs;
	const initialTime = utterance.timeMs;
	const points = [{ time: bounds.endMs, minDelta: bounds.minDelta, maxDelta: bounds.maxDelta }];
	startSelectionMove(event, points, snapTimes, (delta, mergeKey) => {
		const currentLayer = sceneLayers.value.find(layer => layer.id === layerId);
		if (currentLayer?.layerType !== 'voicevox') return false;
		const current = currentLayer.utterances.find(key => key.id === utteranceId);
		// 設定画面でFill・発話長モードへ変えた場合や、別操作でキーが移動・削除された場合はドラッグを続けない。
		if (!current || current.subtitleDuration.mode !== 'specified' || current.timeMs !== initialTime) return false;
		stateManager.commit('editVoicevoxLayer', { sceneId: props.sceneId, layerId, voicevox: currentLayer.voicevox,
																																													utterances: currentLayer.utterances.map(key => key.id === utteranceId ? { ...key, subtitleDuration: { mode: 'specified' as const, durationMs: initialDuration + delta } } : key) }, mergeKey);
		return true;
	});
}

function onKeyframeMoveStart(event: PointerEvent, point: TimelineKeyframeSelection) {
	if (event.button !== 0 || !event.isPrimary || stopSelectionDrag.value || tlElWidth.value <= 0 || tlRangeX.value <= 0) return;
	const key = keyframeSelectionKey(point);
	if (event.ctrlKey || event.metaKey) {
		event.preventDefault();
		const current = selection.value.kind === 'keyframes' ? selection.value.keyframes : [];
		selection.value = { kind: 'keyframes', keyframes: current.some(entry => keyframeSelectionKey(entry) === key) ? current.filter(entry => keyframeSelectionKey(entry) !== key) : [...current, point] };
		tlEl.value?.focus({ preventScroll: true });
		revealDetails();
		return;
	}
	// 発話は絶対時刻のイベントなので、Shiftの時間伸縮には含めず共通移動だけを行う。
	const canStretch = point.target !== 'utterance' && !selectedTimelineKeyframes.value.some(entry => entry.target === 'utterance');
	const stretchSelection = event.shiftKey && canStretch ? getTimelineStretchSelection(keyframeEntries.value.map(entry => entry.selection), selection.value, point) : [];
	const stretchKeys = new Set(stretchSelection.map(keyframeSelectionKey));
	const stretchEntries = keyframeEntries.value.filter(entry => stretchKeys.has(keyframeSelectionKey(entry.selection)));
	const laneEntries = stretchEntries.filter(entry => entry.selection.target === point.target && paramPathKey(entry.selection.paramPath) === paramPathKey(point.paramPath));
	const stretch = event.shiftKey && canStretch ? createKeyframeStretch(laneEntries.map(entry => ({ id: entry.selection.keyframeId, x: entry.x })), point.keyframeId,
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
	revealDetails();
	const selected = new Set(current.keyframes.map(keyframeSelectionKey));
	const entries = keyframeEntries.value.filter(entry => selected.has(keyframeSelectionKey(entry.selection)));
	const otherTimes = [0, ...clipLayers.value.flatMap(entry => entry.clips.flatMap(clip => [clip.startMs, getTimelineClipEnd(clip)])),
																					...keyframeEntries.value.filter(entry => !selected.has(keyframeSelectionKey(entry.selection))).map(entry => entry.time)];
	const affectedLayerIds = new Set(entries.map(entry => entry.selection.layerId));
	const candidatesByLayer = new Map(sceneLayers.value.filter(layer => affectedLayerIds.has(layer.id)).map(layer => {
		// キーはScene時刻のまま、所属レイヤーの各クリップに描いた目盛りへ吸着させる。
		// 空白区間にはローカル目盛りがなく、別レイヤーのクリップも候補に含めない。
		const localTimes = snapSettings.value.localTicks ? getTimelineVisibleClipTicks(
			layer.layerType === 'group' ? [] : layer.clips, tlPosX.value, tlRangeX.value, xTicksCount.value, tickMode.value, tickSubdivisions.value,
		).flatMap(({ ticks }) => [...ticks.major, ...ticks.minor].map(tick => tick.sceneTimeMs)).toSorted((a, b) => a - b) : [];
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
		stateManager.commit('moveTimelineKeyframes', { sceneId: props.sceneId, positions: positions.map(position => ({ ...position, x: movedX(position.x, delta) })) }, mergeKey);
		return true;
	}, delta => getTimelineSnappingTimes(entries.map(entry => ({
		time: entry.time + movedX(entry.x, delta) - entry.x,
		minDelta: 0, maxDelta: 0, snapTimes: candidatesByLayer.get(entry.selection.layerId) ?? [],
	})), [], 0));
}

onBeforeUnmount(() => stopSelectionDrag.value?.());

function onSeekBarPointerDown(ev: PointerEvent) {
	if (ev.button !== 0 || !ev.isPrimary || stopSelectionDrag.value || panning.value || tlEl.value == null || tlElWidth.value <= 0 || tlRangeX.value <= 0) return;
	ev.preventDefault();
	ev.stopPropagation();
	stopSelectionDrag.value = listenPointerDrag(ev, event => {
		const pointerTime = timeAtClientX(event.clientX);
		if (pointerTime == null) return;
		const candidates = snapSeekBar.value ? getTimelineSnapCandidates(snapSettings.value, [], xTicksWithMinor.value) : [];
		const result = getTimelineSeekPosition(Math.round(pointerTime), duration.value, candidates, 1 / pixelsPerMs.value);
		snappingTimes.value = result.snappingTime == null ? [] : [result.snappingTime];
		previewPlayback.seekTimeline(result.timeMs);
	}, () => {
		snappingTimes.value = [];
		stopSelectionDrag.value = undefined;
	});
}

async function onTlKeydown(ev: KeyboardEvent) {
	if (ev.defaultPrevented) return;
	const target = ev.target;
	if (target instanceof HTMLElement && (target.closest('input, textarea, select') || target.isContentEditable)) return;
	const key = ev.key.toLowerCase();
	if (key === 'c' && !(ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey)) { onCueKeyboardDown(ev); return; }
	if ((key === 'delete' || key === 'backspace') && selection.value.kind === 'keyframes') { ev.preventDefault(); ev.stopPropagation(); removeSelectedKeyframes(); return; }
	if ((key === 'delete' || key === 'backspace') && selection.value.kind === 'clips') { ev.preventDefault(); ev.stopPropagation(); removeSelectedClips(); return; }
	if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return;
	if (key === 'c' && selection.value.kind === 'keyframes') {
		ev.preventDefault();
		ev.stopPropagation();
		if (!ev.repeat) timelineClipboard.value = copyTimelineKeyframes(stateManager.state, editedScene, selection.value.keyframes);
		return;
	}
	if (key === 'v' && timelineClipboard.value?.kind === 'keyframes') {
		ev.preventDefault();
		ev.stopPropagation();
		if (ev.repeat || disposed || stateManager.state.timelineScenes.value.find(scene => scene.id === props.sceneId) !== editedScene) return;
		const keyframes = prepareTimelineKeyframePaste(stateManager.state, editedScene, timelineClipboard.value, time.value);
		if (!keyframes) return;
		stateManager.commit('pasteTimelineKeyframes', { sceneId: props.sceneId, keyframes });
		selection.value = { kind: 'keyframes', keyframes: keyframes.map(getPastedTimelineKeySelection) };
		tlEl.value?.focus({ preventScroll: true });
		return;
	}
	if (key === 'c' && selection.value.kind === 'clips') {
		ev.preventDefault();
		ev.stopPropagation();
		if (!ev.repeat) timelineClipboard.value = copyTimelineClips(editedScene, selection.value.clips);
		return;
	}
	if (key === 'v' && timelineClipboard.value?.kind === 'clips') {
		ev.preventDefault();
		ev.stopPropagation();
		if (!ev.repeat) await pasteClips(timelineClipboard.value);
		return;
	}
	if (key === 'c') {
		if (selectedLayer.value == null || selection.value.kind !== 'layers') return;
		ev.preventDefault();
		ev.stopPropagation();
		if (ev.repeat) return;
		// コピー後の編集がクリップボードの内容に影響しないよう、ここでスナップショットを作る。
		timelineClipboard.value = { kind: 'layer', layer: deepClone(selectedLayer.value) };
	} else if (key === 'v') {
		if (timelineClipboard.value?.kind !== 'layer' || selection.value.kind === 'clips') return;
		ev.preventDefault();
		ev.stopPropagation();
		if (ev.repeat) return;
		const sourceLayerId = timelineClipboard.value.layer.id;
		const [layer] = duplicateTimelineLayers([timelineClipboard.value.layer]);
		// レイヤー全体の複製ではScene上のキーと全クリップの位置関係をそのまま保持する。
		try {
			const scene = sceneLayers.value;
			const sourceDurationsMs = await readLayerMediaDurations(layer);
			if (disposed || sceneLayers.value !== scene) return;
			stateManager.commit('pasteTimelineLayer', { sceneId: props.sceneId, layer, sourceLayerId, sourceDurationsMs });
		} catch (error) {
			console.error(error);
			ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
			return;
		}
		selectLayer(layer);
	}
}

async function pasteClips(clipboard: TimelineClipClipboard) {
	const scene = stateManager.state.timelineScenes.value.find(scene => scene.id === props.sceneId);
	if (!scene || scene !== editedScene) return;
	// シーク位置は操作時点で固定し、素材情報の読み込み中に再生が進んでも位置を変えない。
	const clips = prepareTimelineClipPaste(scene, clipboard, time.value);
	if (!clips) return;
	try {
		const sources = clips.flatMap(({ layerId, clip }) => {
			const layer = findTimelineLayer(scene.layers, layerId)!;
			if (layer.layerType !== 'audio' && layer.layerType !== 'video') return [];
			const asset = 'assetId' in clip ? stateManager.state.assets.value.find(asset => asset.id === clip.assetId) : undefined;
			if (!asset) throw new Error('Missing media');
			return [{ layerId, clipId: clip.id, asset, blob: asset.fileData }];
		});
		const durations = await Promise.all(sources.map(async ({ layerId, clipId, asset }) => ({ layerId, clipId, durationMs: (await inspectTimelineClipMedia(asset)).durationMs })));
		if (disposed || stateManager.state.timelineScenes.value.find(entry => entry.id === props.sceneId) !== scene) return;
		if (sources.some(({ asset, blob }) => !stateManager.state.assets.value.includes(asset) || asset.fileData !== blob)) return;
		// 読み込み待ちの間にクリップが追加・移動されても、重なる場合は履歴を作らず終了する。
		if (!canPasteTimelineClips(scene, clips)) return;
		const sourceDurationsMs: TimelineClipSourceDurations = Object.create(null);
		for (const { layerId, clipId, durationMs } of durations) (sourceDurationsMs[layerId] ??= Object.create(null))[clipId] = durationMs;
		stateManager.commit('pasteTimelineClips', { sceneId: props.sceneId, clips, sourceDurationsMs });
		selection.value = { kind: 'clips', clips: clips.map(({ layerId, clip }) => ({ layerId, clipId: clip.id })) };
		tlEl.value?.focus({ preventScroll: true });
	} catch (error) {
		console.error(error);
		ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
	}
}

function selectLayer(layer: TimelineLayer, event?: MouseEvent) {
	const next = selectTimelineLayer(selection.value, visibleLayers.value.map(entry => entry.id), layer.id, editorState.layerSelectionAnchorId, {
		range: event?.shiftKey ?? false, additive: (event?.ctrlKey || event?.metaKey) ?? false,
	});
	selection.value = next.selection;
	editorState.layerSelectionAnchorId = next.anchorId;
	revealDetails();
	tlEl.value?.focus({ preventScroll: true });
}

let disposeEffectPicker: (() => void) | undefined;
onBeforeUnmount(() => {
	stopCueHold?.();
	disposed = true;
	disposeEffectPicker?.();
});

function showAddInlineEffectNodeMenu(layerId: string) {
	const layer = sceneLayers.value.find(layer => layer.id === layerId);
	if (layer?.layerType !== 'inlineVisualModule') return;
	disposeEffectPicker?.();
	const { dispose } = ui.popup(GsEffectPicker, {}, {
		chosen: effect => {
			// 選択変更やレイヤー削除を挟んでも、ピッカーを開いた対象にだけ追加する。
			if (!sceneLayers.value.some(layer => layer.id === layerId && layer.layerType === 'inlineVisualModule')) return;
			stateManager.commit('addEffectNode', { sceneId: props.sceneId, inlineVisualModuleLayerId: layerId, effectId: effect.id, id: genId() });
		},
		closed: () => {
			dispose();
			if (disposeEffectPicker === dispose) disposeEffectPicker = undefined;
		},
	});
	disposeEffectPicker = dispose;
}

const audioError = ref<string | null>(null);
const mediaInfo = shallowRef<ReadonlyMap<string, TimelineClipMediaInfo>>(new Map());
const mediaAssets = computed(() => {
	const ids = new Set(sceneLayers.value.flatMap(layer => layer.layerType === 'video' || layer.layerType === 'audio' ? layer.clips.map(clip => clip.assetId) : []));
	return stateManager.state.assets.value.filter(asset => ids.has(asset.id));
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

function removeSelectedClips() {
	if (selection.value.kind !== 'clips' || selection.value.clips.length === 0) return;
	stateManager.commit('removeTimelineClips', { sceneId: props.sceneId, clips: deepClone(selection.value.clips) });
}

type ClipSource = { kind: 'asset'; asset: Asset; media?: TimelineClipMediaInfo } | { kind: 'scene'; scene: TimelineScene };

async function chooseClipSource(layerType: 'image' | 'video' | 'audio' | 'scene'): Promise<ClipSource | null> {
	const scene = sceneLayers.value;
	const assets = stateManager.state.assets.value;
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
	if (canceled || !asset || disposed || sceneLayers.value !== scene || stateManager.state.assets.value !== assets) return null;
	const blob = asset.fileData;
	try {
		const media = layerType === 'image' ? undefined : await inspectTimelineClipMedia(asset);
		if (disposed || sceneLayers.value !== scene || !stateManager.state.assets.value.includes(asset) || asset.fileData !== blob) return null;
		if (media?.audioError) {
			const result = await ui.confirm({ type: 'warning', title: asset.name, text: media.audioError, okText: 'Add without audio' });
			if (result.canceled || disposed || sceneLayers.value !== scene || !stateManager.state.assets.value.includes(asset) || asset.fileData !== blob) return null;
		}
		return { kind: 'asset', asset, media };
	} catch (error) { audioError.value = error instanceof Error ? error.message : String(error); return null; }
}

async function addClip(layer: TimelineLayer, startMs: number) {
	if (layer.layerType === 'group') return;
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
		stateManager.commit('addTimelineClip', { sceneId: props.sceneId, layerId: layer.id, clip, sourceDurationMs });
		selectClip({ layerId: layer.id, clipId: clip.id });
	} catch (error) { audioError.value = error instanceof Error ? error.message : String(error); }
}

async function changeClipSource(target: TimelineClipSelection) {
	const entry = resolveClip(target);
	if (!entry) return;
	const type = entry.layer.layerType;
	if (type !== 'image' && type !== 'video' && type !== 'audio' && type !== 'scene') return;
	const source = await chooseClipSource(type);
	if (!source || disposed || resolveClip(entry.target)?.clip !== entry.clip) return;
	if (source.kind === 'asset' && 'assetId' in entry.clip && entry.clip.assetId === source.asset.id) return;
	if (source.kind === 'scene' && 'sceneId' in entry.clip && entry.clip.sceneId === source.scene.id) return;
	try {
		stateManager.commit('changeTimelineClipSource', {
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

async function readLayerMediaDurations(layer: TimelineLayer): Promise<TimelineClipSourceDurations | undefined> {
	if (layer.layerType === 'group') return Object.assign(Object.create(null), ...await Promise.all(layer.layers.map(readLayerMediaDurations)));
	if (layer.layerType !== 'audio' && layer.layerType !== 'video') return undefined;
	const sources = layer.clips.map(clip => {
		const asset = stateManager.state.assets.value.find(asset => asset.id === clip.assetId);
		if (!asset) throw new Error('Missing media');
		return { clipId: clip.id, asset, blob: asset.fileData };
	});
	const durations = await Promise.all(sources.map(async ({ clipId, asset }) => [clipId, (await inspectTimelineClipMedia(asset)).durationMs] as const));
	if (sources.some(({ asset, blob }) => !stateManager.state.assets.value.includes(asset) || asset.fileData !== blob)) throw new Error('Media changed during loading');
	return { [layer.id]: Object.fromEntries(durations) };
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
	const base = { id: genId(), name: source.kind === 'asset' ? source.asset.name : source.scene.name, automationGraphs: [], isDisabled: false };
	const audioParamValues = { volume: deepClone(timelineAudioParamDefs.volume.defaultValue) };
	const compositingParamValues = initialCompositingParameters();
	let layer: TimelineLayer;
	if (layerType === 'scene' && source.kind === 'scene') layer = { ...base, layerType, clips: [{ ...clip, sceneId: source.scene.id }], audioParamValues, compositingParamValues };
	else if (source.kind === 'asset' && layerType === 'image') layer = { ...base, layerType, clips: [{ ...clip, assetId: source.asset.id }], compositingParamValues };
	else if (source.kind === 'asset' && layerType === 'audio') layer = { ...base, layerType, clips: [{ ...clip, assetId: source.asset.id }], audioParamValues };
	else if (source.kind === 'asset' && layerType === 'video') layer = { ...base, layerType, clips: [{ ...clip, assetId: source.asset.id, audioEnabled: !!source.media?.audioAvailable }], audioParamValues, compositingParamValues };
	else return;
	stateManager.commit('addTimelineLayer', { sceneId: props.sceneId, layer, sourceDurationsMs: sourceDurationMs == null ? undefined : { [layer.id]: { [clip.id]: sourceDurationMs } } });
	selectClip({ layerId: layer.id, clipId: clip.id });
}

async function addReferencedModuleLayer() {
	const scene = sceneLayers.value;
	const { canceled, result: id } = await ui.select({ title: 'Select Visual Module', items: stateManager.state.visualModules.value.map(module => ({ label: module.name, value: module.id })) });
	const module = stateManager.state.visualModules.value.find(module => module.id === id);
	if (canceled || !module || disposed || sceneLayers.value !== scene) return;
	const layer: TimelineLayer = {
		id: genId(), name: module.name,
		layerType: 'visualModule',
		isDisabled: false,
		visualModuleId: module.id,
		clips: [{ id: genId(), ...createTimelineClipTiming(Math.max(0, time.value), 5000) }],
		visualModuleParamValues: {}, compositingParamValues: initialCompositingParameters(), automationGraphs: [],
	};
	stateManager.commit('addTimelineLayer', { sceneId: props.sceneId, layer });
	selectLayer(layer);
}

function play() {
	previewPlayback.playTimeline();
}

function pause() {
	previewPlayback.pauseTimeline();
}

function seek(timeMs: number) {
	previewPlayback.seekTimeline(Math.max(0, Math.min(duration.value, timeMs)));
}

function stepFrame(direction: -1 | 1) {
	// 再生中は音声時計の最新位置で停止してから、設定fpsに相当する時間だけ進める。
	previewPlayback.pauseTimeline();
	seek(time.value + direction * 1000 / stateManager.state.timelineFps.value);
}

function startCue(): () => void {
	// 通常再生中に押した場合も、音声時計の最新位置を取得してから戻り先を記録する。
	previewPlayback.pauseTimeline();
	const startTime = time.value;
	const startPositionX = tlPosX.value;
	cueActive.value = true;
	previewPlayback.playTimeline();
	return () => {
		if (!cueActive.value) return;
		cueActive.value = false;
		stopCueHold = undefined;
		// Scene切替やプロジェクト読み込み後に、旧Sceneの位置を新しいSceneへ反映しない。
		if (activeSceneId.value !== props.sceneId || stateManager.state.timelineScenes.value.find(scene => scene.id === props.sceneId) !== editedScene) return;
		previewPlayback.pauseTimeline();
		previewPlayback.seekTimeline(startTime);
		// CUEは一時的な試聴なので、追従で移動した表示範囲も元へ戻す。
		if (followPlayhead.value) tlPosX.value = startPositionX;
	};
}

function onCuePointerDown(event: PointerEvent) {
	if (event.button !== 0 || !event.isPrimary || cueActive.value || duration.value <= 0) return;
	event.preventDefault();
	event.stopPropagation();
	stopCueHold = listenPointerDrag(event, () => {}, startCue());
}

function onCueButtonKeydown(event: KeyboardEvent) {
	if (event.key !== ' ' && event.key !== 'Enter') return;
	onCueKeyboardDown(event);
}

function onCueKeyboardDown(event: KeyboardEvent) {
	event.preventDefault();
	event.stopPropagation();
	if (event.repeat || cueActive.value || duration.value <= 0) return;
	const ownerWindow = (event.currentTarget as HTMLElement).ownerDocument.defaultView;
	if (ownerWindow == null) return;
	const finishCue = startCue();
	const onKeyup = (released: KeyboardEvent) => { if (released.code === event.code) finish(); };
	const finish = () => {
		ownerWindow.removeEventListener('keyup', onKeyup);
		ownerWindow.removeEventListener('blur', finish);
		ownerWindow.removeEventListener('pagehide', finish);
		finishCue();
	};
	ownerWindow.addEventListener('keyup', onKeyup);
	ownerWindow.addEventListener('blur', finish);
	ownerWindow.addEventListener('pagehide', finish);
	stopCueHold = finish;
}

function showAddEffectLayerMenu() {
	const sceneId = props.sceneId;
	const startMs = Math.max(0, time.value);
	disposeEffectPicker?.();
	const { dispose } = ui.popup(GsEffectPicker, {}, {
		chosen: definition => {
			if (props.sceneId !== sceneId) return;
			const layer = createEffectTimelineLayer(definition, startMs);
			stateManager.commit('addTimelineLayer', { sceneId, layer });
			selectLayer(layer);
			previewPlayback.seekTimeline(layer.clips[0].startMs);
		},
		closed: () => { dispose(); if (disposeEffectPicker === dispose) disposeEffectPicker = undefined; },
	});
	disposeEffectPicker = dispose;
}

function showAddLayerMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: 'Group', icon: 'ti ti-folder-plus', action: addEmptyGroup,
	}, {
		text: 'Effect',
		icon: 'ti ti-sparkles',
		action: showAddEffectLayerMenu,
	}, {
		text: 'Text',
		icon: 'ti ti-typography',
		action: () => {
			const layer = createTextTimelineLayer(Math.max(0, time.value));
			stateManager.commit('addTimelineLayer', { sceneId: props.sceneId, layer });
			selectLayer(layer);
			previewPlayback.seekTimeline(layer.clips[0].startMs);
		},
	}, {
		type: 'parent',
		text: 'Shape',
		icon: 'ti ti-shape',
		children: (Object.keys(shapeDefinitions) as ShapeType[]).map(type => ({
			text: shapeDefinitions[type].label,
			icon: type === 'ellipse' ? 'ti ti-circle' : 'ti ti-rectangle',
			action: () => {
				const layer = createShapeTimelineLayer(type, Math.max(0, time.value));
				stateManager.commit('addTimelineLayer', { sceneId: props.sceneId, layer });
				selectLayer(layer);
				previewPlayback.seekTimeline(layer.clips[0].startMs);
			},
		})),
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
			stateManager.commit('addTimelineLayer', { sceneId: props.sceneId, layer });
			selectLayer(layer);
			previewPlayback.seekTimeline(layer.clips[0].startMs);
		},
	}, {
		text: 'Visual Module (Reference)',
		icon: 'ti ti-chart-dots-3',
		action: addReferencedModuleLayer,
	}, {
		text: 'Scene',
		icon: 'ti ti-memory',
		action: () => addMediaLayer('scene'),
	}, {
		text: window.desktop ? 'VOICEVOX' : 'VOICEVOX (使用不可)',
		icon: 'ti ti-microphone',
		action: () => {
			if (!window.desktop) {
				ui.alert({ type: 'error', text: 'VOICEVOXレイヤーの追加はWeb版では対応していません。Electron版を使用する必要があります。' });
				return;
			}
			const layer = createVoicevoxTimelineLayer(Math.max(0, time.value));
			stateManager.commit('addTimelineLayer', { sceneId: props.sceneId, layer });
			selectLayer(layer);
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

</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	height: 100%;
	contain: strict;

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
	grid-template-columns: 1fr 1fr 1fr 1fr 1fr;
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

.cueButton {
	touch-action: none;
	user-select: none;
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
	display: flex;
	width: var(--sideWidth);
	align-items: center;
	justify-content: center;
	gap: 8px;
	margin-bottom: 8px;
}

.layersActions {
	flex-shrink: 0;
	width: var(--sideWidth);
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	margin-bottom: 8px;
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
	touch-action: none;
	user-select: none;
	cursor: ew-resize;
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
	position: relative;
	pointer-events: none;
	direction: ltr;

	&:focus {
		outline: none;
		//outline: solid 7px #fff;
	}

	//&:before {
	//	content: "";
	//	display: block;
	//	position: absolute;
	//	top: 0;
	//	left: 0;
	//	width: 30px;
	//	height: 100%;
	//	pointer-events: none;
	//	background: linear-gradient(90deg, #0008, #0000);
	//}
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
	0% {
		opacity: 1;
		transform: scale(1);
	}
	30% {
		opacity: 1;
		transform: scale(1);
	}
	90% {
		opacity: 0;
		transform: scale(0.5);
	}
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

.layerSettings {
	min-height: 0;
	overflow-y: auto;
}

.keyframeEditor {
	display: grid;
	gap: 12px;
	padding: 16px;
}

.drop_before {
	position: relative;
	&:after {
		content: '';
		display: block;
		position: absolute;
		z-index: 1;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		box-sizing: border-box;
		border-top: solid 2px var(--THEME-accent);
	}
}
.drop_after {
	position: relative;
	&:after {
		content: '';
		display: block;
		position: absolute;
		z-index: 1;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		box-sizing: border-box;
		border-bottom: solid 2px var(--THEME-accent);
	}
}
.drop_inside {
	position: relative;
	&:after {
		content: '';
		display: block;
		position: absolute;
		z-index: 1;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		box-sizing: border-box;
		//border: solid 2px var(--THEME-accent);
		background: color(from var(--THEME-accent) srgb r g b / 0.25);
	}
}
</style>
