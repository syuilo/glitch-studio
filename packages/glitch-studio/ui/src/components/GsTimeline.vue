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
						@contextMenu="event => layerActions.showMenu(event, layer)"
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
import { getTimelineClipEnd } from '@gs/subsystems_timeline_shared/timing.ts';
import { computed, onBeforeUnmount, ref, shallowRef, toRef, useTemplateRef, watch } from 'vue';
import { genId } from '@gs/shared/utility/id.js';
import { timelineAudioParamDefs } from '@gs/subsystems_timeline_shared/timeline-audio.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import XLayer from './GsTimeline.Layer.vue';
import GsTimelineInspector from './GsTimeline.Inspector.vue';
import GsButton from './common/GsButton.vue';
import GsVirtualScroll from './common/GsVirtualScroll.vue';
import GsEffectPicker from './GsEffectPicker.vue';
import type { TimelineGroupLayer, TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineClipSelection, TimelineKeyframeSelection } from '@/utility/timeline-selection.ts';
import type { TimelineClipMediaInfo } from '@/utility/timeline-clip-media.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import { getTimelineKeyframeEditTarget } from '@/utility/timeline-keyframe-edit.ts';
import { useTimelineInteraction } from '@/composables/useTimelineInteraction.ts';
import { useTimelineMarqueeSelection } from '@/composables/useTimelineMarqueeSelection.ts';
import { useTimelineSelectionDrag } from '@/composables/useTimelineSelectionDrag.ts';
import { createTimelineDragActions } from '@/utility/timeline-drag-actions.ts';
import { useTimelineViewport } from '@/composables/useTimelineViewport.ts';
import { formatTimelineTimecode as formatMsToTimecode } from '@/utility/timeline-ticks.ts';
import { preferences } from '@/preferences.ts';
import { listenPointerDrag } from '@/utility/pointer-drag.ts';
import { getTimelineKeyframeEntries, getTimelineKeyframeLanes } from '@/utility/timeline-keyframe-lanes.ts';
import { inspectTimelineClipMedia } from '@/utility/timeline-clip-media.ts';
import { selectTimelineLayer, clipSelectionKey, keyframeSelectionKey } from '@/utility/timeline-selection.ts';
import { appContext } from '@/app.ts';
import { getTimelineEditorState, getSelectedTimelineLayerId, timelineClipboard } from '@/utility/timeline-editor-state.ts';
import * as ui from '@/ui.ts';
import { createTimelineSourceActions } from '@/utility/timeline-source-actions.ts';
import { createTimelineClipboardActions } from '@/utility/timeline-clipboard-actions.ts';
import { createTimelineLayerActions } from '@/utility/timeline-layer-actions.ts';

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

const interaction = useTimelineInteraction();
const { onTimelineClick } = interaction;
const viewport = useTimelineViewport({
	timelineElement: tlEl, layersElement: layersEl, savedState: editorState,
	currentTime: time, isPlaying: previewPlayback.isTimelinePlaying, followPlayhead, tickMode, tickSubdivisions,
	interactionActive: interaction.active,
});
const {
	positionX: tlPosX, rangeX: tlRangeX, width: tlElWidth, pixelsPerMs, optimizeHorizontalMovement,
	ticks: xTicks, minorTicks: xMinorTicks,
	timeToX: timeToDomX, timeAtX,
	onTimelineWheel, onBackgroundWheel: onTlWheel, onRulerWheel: onXTicksWheel, onPanMousedown, onPanAuxclick,
} = viewport;

const seekBarPos = computed(() => {
	return timeToDomX(time.value);
});
const cursorBarPos = ref<number | null>(null);
const tlRangeElPosX = computed(() => {
	return timeToDomX(0);
});
const tlRangeElWidth = computed(() => {
	return duration.value * pixelsPerMs.value;
});
const tooltipDomPos = ref<null | [number, number]>(null);
const cursorTime = ref(0);
const cursorValue = ref(0);

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

const { selectionArea, onBackgroundPointerDown, onVirtualLayersLayout } = useTimelineMarqueeSelection({
	sceneId: () => props.sceneId, timelineElement: tlEl, layersElement: layersEl, virtualLayers,
	viewport, interaction, layers: marqueeLayers, layerSizeKeys, rulerHeight: X_TICKS_HEIGHT, selection, revealDetails,
});
const selectionDrag = useTimelineSelectionDrag({
	timelineElement: tlEl, layersElement: layersEl, viewport, interaction, duration, snapSettings, snapSeekBar,
	seek: timeMs => previewPlayback.seekTimeline(timeMs),
});
const { movingSelection, snappingTimes, onSeekBarPointerDown } = selectionDrag;
const mediaInfo = shallowRef<ReadonlyMap<string, TimelineClipMediaInfo>>(new Map());
const { onGroupMoveStart, onClipMoveStart, onClipTrimStart, onSubtitleTrimStart, onKeyframeMoveStart } = createTimelineDragActions({
	stateManager, scene: editedScene, sceneLayers, keyframeEntries, selection, mediaInfo, viewport, drag: selectionDrag,
	snapping: { settings: snapSettings, clipSettings: clipSnapSettings, tickMode, tickSubdivisions, currentTime: time },
	selectLayer, selectClip, selectKeyframe: onKeyframeSelected, revealDetails,
	focusTimeline: () => tlEl.value?.focus({ preventScroll: true }),
});

const audioError = ref<string | null>(null);

// SceneのIDだけではプロジェクト読み込みによる同IDの差し替えを検出できないため、定義の同一性も確認する。
function isTimelineActive() {
	return !disposed && props.sceneId === editedScene.id && stateManager.state.timelineScenes.value.find(scene => scene.id === editedScene.id) === editedScene;
}

const { addClip, changeClipSource, showAddLayerMenu, readLayerMediaDurations } = createTimelineSourceActions({
	stateManager, scene: editedScene, sceneLayers, currentTime: time, isActive: isTimelineActive,
	inspectMedia: inspectTimelineClipMedia, ui, pickEffect: showEffectPicker, desktopAvailable: () => !!window.desktop,
	selectLayer, selectClip, addEmptyGroup, seek: timeMs => previewPlayback.seekTimeline(timeMs),
	reportError: error => { audioError.value = error instanceof Error ? error.message : String(error); },
});
const clipboardActions = createTimelineClipboardActions({
	stateManager, scene: editedScene, sceneLayers, selection, selectedLayer, clipboard: timelineClipboard,
	currentTime: time, isActive: isTimelineActive, inspectMedia: inspectTimelineClipMedia, readLayerMediaDurations,
	selectLayer, focusTimeline: () => tlEl.value?.focus({ preventScroll: true }),
	reportError: error => {
		console.error(error);
		ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
	},
});

const layerActions = createTimelineLayerActions({
	stateManager, scene: editedScene, selection, isActive: isTimelineActive, readLayerMediaDurations,
	selectLayer, canGroup: () => canGroupSelection.value, groupSelection, ui,
	focusTimeline: () => tlEl.value?.focus({ preventScroll: true }),
});

async function onTlKeydown(ev: KeyboardEvent) {
	if (ev.defaultPrevented) return;
	const target = ev.target;
	if (target instanceof HTMLElement && (target.closest('input, textarea, select') || target.isContentEditable)) return;
	const key = ev.key.toLowerCase();
	if (key === 'c' && !(ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey)) { onCueKeyboardDown(ev); return; }
	if ((key === 'delete' || key === 'backspace') && selection.value.kind === 'keyframes') { ev.preventDefault(); ev.stopPropagation(); removeSelectedKeyframes(); return; }
	if ((key === 'delete' || key === 'backspace') && selection.value.kind === 'clips') { ev.preventDefault(); ev.stopPropagation(); removeSelectedClips(); return; }
	if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return;
	if (key === 'c' && clipboardActions.canCopy()) {
		ev.preventDefault();
		ev.stopPropagation();
		if (!ev.repeat) clipboardActions.copySelection();
	} else if (key === 'v' && clipboardActions.canPaste()) {
		ev.preventDefault();
		ev.stopPropagation();
		if (!ev.repeat) await clipboardActions.paste();
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

function showEffectPicker(chosen: (definition: EffectDefinition) => void) {
	disposeEffectPicker?.();
	const { dispose } = ui.popup(GsEffectPicker, {}, {
		chosen,
		closed: () => {
			dispose();
			if (disposeEffectPicker === dispose) disposeEffectPicker = undefined;
		},
	});
	disposeEffectPicker = dispose;
}

function showAddInlineEffectNodeMenu(layerId: string) {
	const layer = sceneLayers.value.find(layer => layer.id === layerId);
	if (layer?.layerType !== 'inlineVisualModule') return;
	showEffectPicker(effect => {
		// 選択変更やレイヤー削除を挟んでも、ピッカーを開いた対象にだけ追加する。
		if (!isTimelineActive() || !sceneLayers.value.some(layer => layer.id === layerId && layer.layerType === 'inlineVisualModule')) return;
		stateManager.commit('addEffectNode', { sceneId: props.sceneId, inlineVisualModuleLayerId: layerId, effectId: effect.id, id: genId() });
	});
}

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

function initialCompositingParameters() {
	return deepClone(Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, def.defaultValue]))) as import('@gs/subsystems_timeline_shared/types.ts').TimelineImageLayer['compositingParamValues'];
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
	position: relative;
	pointer-events: none;
	direction: ltr;

	&:focus {
		outline: none;
		//outline: solid 7px #fff;
	}

	&:before {
		content: "";
		display: block;
		position: absolute;
		z-index: 0; // GsTimeline.Layer.vueの.stickyArrowよりは後ろに表示したいため
		top: 0;
		left: 0;
		width: 20px;
		height: 100%;
		pointer-events: none;
		background: linear-gradient(90deg, #0008, #0000);
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
