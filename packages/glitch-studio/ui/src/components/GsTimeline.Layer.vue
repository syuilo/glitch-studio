<template>
<div :class="[$style.root, { [$style.selected]: selected, [$style.disabled]: layer.isDisabled || ancestorDisabled, [$style.groupExpanded]: layer.layerType === 'group' && !collapsed, [$style.type_effect]: layer.layerType === 'effect', [$style.type_audio]: layer.layerType === 'audio', [$style.type_image]: layer.layerType === 'image', [$style.type_video]: layer.layerType === 'video', [$style.type_text]: layer.layerType === 'text', [$style.type_voicevox]: layer.layerType === 'voicevox', [$style.type_group]: layer.layerType === 'group' }]" :data-timeline-layer-id="layer.id">
	<div :class="$style.mainLane" data-timeline-clip-lane>
		<div :class="$style.side">
			<div v-for="i in (depth ?? 0) + 1" :class="[$style.colorBar, { [$style.parentColorBar]: i < (depth ?? 0) + 1 }]"></div>
			<div :class="$style.sideBody">
				<div :class="$style.layerHeader" draggable="true" @click="emit('selected', $event)" @contextmenu.stop.prevent="emit('contextMenu', $event)" @dragstart.stop="emit('dragStart', $event)">
					<div :class="$style.grabber">
						<svg viewBox="0 0 16 16" version="1.1" :class="$style.grabberSvg">
							<path fill="currentColor" d="M10 13a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm0-4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm-4 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm5-9a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM6 5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path>
						</svg>
					</div>
					<i :class="'ti ' + layerIcon"></i>
					<span :class="$style.layerHeaderTitle">
						<GsCondensedLine>{{ layer.name }}</GsCondensedLine>
					</span>
					<button class="_button" :class="[$style.collapseButton]" :aria-expanded="!collapsed" :aria-label="(collapsed ? 'Expand ' : 'Collapse ') + layer.name" @click.stop="emit('toggleCollapse')"><i :class="collapsed ? 'ti ti-chevron-right' : 'ti ti-chevron-down'"></i></button>
					<button class="_button" :class="[$style.disableButton, { [$style.active]: !layer.isDisabled }]" @click.stop="toggleDisabled"><i :class="layer.isDisabled ? 'ti ti-eye-off' : 'ti ti-eye'"></i></button>
				</div>
			</div>
		</div>
		<div :class="$style.tl" @dblclick.stop.prevent="onBackgroundDoubleClick">
			<button v-if="offscreenClips.previous" class="_button" :class="$style.stickyArrow" style="left: 0;" @click.stop="look(offscreenClips.previous)" @dblclick.stop><i class="ti ti-arrow-left"></i></button>
			<button v-if="offscreenClips.next" class="_button" :class="$style.stickyArrow" style="right: 0;" @click.stop="look(offscreenClips.next)" @dblclick.stop><i class="ti ti-arrow-right"></i></button>
			<div :class="$style.scrollingContent" :style="scrollingStyle">
				<button
					v-if="groupRange" type="button" class="_button" :class="[$style.groupClip, { [$style.groupClipSelected]: selected }]"
					:style="{ left: groupRange.startMs * pixelsPerMs + 'px', width: groupRange.durationMs * pixelsPerMs + 'px' }"
					:aria-label="'Move group ' + layer.name" @pointerdown.stop="emit('groupMoveStart', $event)" @dblclick.stop
				>
					<span>{{ layer.name }}</span>
				</button>
				<XClips
					v-if="layer.layerType !== 'group'"
					:items="clipItems"
					:pixelsPerMs="pixelsPerMs"
					:sceneTimeMs="sceneTimeMs"
					:isDisabled="layer.isDisabled"
					:selectedClipIds="selectedClipIds"
					:moving="moving"
					@moveStart="(event, clipId) => emit('clipMoveStart', event, { layerId: layer.id, clipId })"
					@trimStart="(event, clipId, edge) => emit('clipTrimStart', event, { layerId: layer.id, clipId }, edge)"
				/>
			</div>
		</div>
	</div>
	<div v-if="!collapsed && layer.layerType !== 'group' && (keyframeParameters.length > 0 || layer.layerType === 'voicevox')" :class="$style.localTicksLane">
		<div :class="$style.side">
			<div v-for="i in (depth ?? 0) + 1" :class="[$style.colorBar, { [$style.parentColorBar]: i < (depth ?? 0) + 1 }]"></div>
			<div :class="$style.sideBody">
				<div :class="[$style.localTicksLabel]">Clip time</div>
			</div>
		</div>
		<div :class="[$style.tl, $style.localTicks]">
			<div v-for="{ clip, ticks } in visibleClipTicks" :key="clip.id" :class="$style.localTicksRange" :style="{ left: timeToDomX(clip.startMs) + 'px', width: clip.durationMs / tlRangeX * tlElWidth + 'px' }">
				<div v-for="tick of ticks.major" :key="tick.contentTimeMs" :class="$style.localTick" class="_monospace" :style="{ left: (tick.sceneTimeMs - clip.startMs) / tlRangeX * tlElWidth + 'px' }">{{ formatTimelineTimecode(tick.contentTimeMs) }}</div>
				<div v-for="tick of ticks.minor" :key="tick.contentTimeMs" :class="$style.localMinorTick" :style="{ left: (tick.sceneTimeMs - clip.startMs) / tlRangeX * tlElWidth + 'px' }"></div>
			</div>
		</div>
	</div>
	<div v-if="!collapsed && layer.layerType === 'voicevox'" :class="$style.speechLane" data-parameter-target="utterance" :data-param-path="JSON.stringify(['utterances'])">
		<div :class="$style.side">
			<div v-for="i in (depth ?? 0) + 1" :class="[$style.colorBar, { [$style.parentColorBar]: i < (depth ?? 0) + 1 }]"></div>
			<div :class="$style.sideBody">
				<div>Speech</div>
			</div>
		</div>
		<VoicevoxKeys
			:class="$style.tl" :sceneId="sceneId" :layer="layer" :pixelsPerMs="pixelsPerMs" :offsetMs="tlPosX"
			:selectedKeyframeIds="selectedKeyframeIdsByParameter.get(JSON.stringify(['utterance', ['utterances']])) ?? emptySelectionIds"
			@dragStart="(event, keyframeId) => emit('keyframeDragStart', event, { layerId: layer.id, target: 'utterance', paramPath: ['utterances'], keyframeId })"
			@selected="keyframeId => emit('keyframeSelected', { layerId: layer.id, target: 'utterance', paramPath: ['utterances'], keyframeId })"
			@subtitleTrimStart="(event, utteranceId, clipId) => emit('subtitleTrimStart', event, layer.id, utteranceId, clipId)"
		/>
	</div>
	<div v-for="param in keyframeParameters" :key="param.key" :class="$style.keyframesLane" :data-parameter-target="param.target" :data-param-path="paramPathKey(param.paramPath)">
		<div :class="$style.side">
			<div v-for="i in (depth ?? 0) + 1" :class="[$style.colorBar, { [$style.parentColorBar]: i < (depth ?? 0) + 1 }]"></div>
			<div :class="$style.sideBody">
				<div style="padding-right: 6px;">{{ param.label }}</div>
			</div>
		</div>
		<div :class="$style.tl" @dblclick.stop.prevent="onKeyframeBackgroundDoubleClick(param, $event)">
			<div :class="$style.scrollingContent" :style="scrollingStyle">
				<XKeyframes
					:keyframes="param.binding.keyframesTimeline.keyframes"
					:paramDef="param.def"
					:pixelsPerMs="pixelsPerMs"
					:selectedKeyframeIds="selectedKeyframeIdsByParameter.get(param.key) ?? emptySelectionIds"
					@dragStart="(event, keyframeId) => emit('keyframeDragStart', event, { layerId: layer.id, target: param.target, paramPath: param.paramPath, keyframeId })"
				/>
			</div>
		</div>
	</div>
	<div :class="$style.gapLane">
		<div :class="$style.side">
			<div v-for="i in (depth ?? 0) + (isLastOfGroup ? -1 : (layer.layerType === 'group' && !collapsed) ? 1 : 0)" :class="[$style.colorBar, $style.parentColorBar]"></div>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { getTimelineGroupRange } from '@gs/subsystems_timeline_shared/layers/group/group.ts';
import { computed } from 'vue';
import { paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import { getSceneDuration } from '@gs/subsystems_timeline_shared/scenes.ts';
import { getTimelineClipEnd } from '@gs/subsystems_timeline_shared/timing.ts';
import GsCondensedLine from './common/GsCondensedLine.vue';
import VoicevoxKeys from './GsTimeline.VoicevoxKeys.vue';
import XClips from './GsTimeline.Layer.Clips.vue';
import XKeyframes from './GsTimeline.Layer.Keyframes.vue';
import GsButton from './common/GsButton.vue';
import type { TimelineClip, TimelineAssetClip, TimelineVideoClip, TimelineSceneClip } from '@gs/subsystems_timeline_shared/clip.ts';
import type { TimelineKeyframeSelection, TimelineClipSelection } from '@/utility/timeline-selection.ts';
import type { TimelineTickMode, TimelineTickSubdivisions } from '@/utility/timeline-ticks.ts';
import type { TimelineClipMediaInfo } from '@/utility/timeline-clip-media.ts';
import type { TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { timelineTimeToX, timelinePointerTime } from '@/utility/timeline-coordinates.ts';
import { appContext } from '@/app.ts';
import { formatTimelineTimecode, getTimelineVisibleClipTicks, getTimelineTickCount } from '@/utility/timeline-ticks.ts';
import { resolveLayerParameter, getLayerKeyframeParameters } from '@/utility/timeline-scene.ts';
import { insertInlineKeyframe } from '@/utility/keyframes-timeline.ts';

const { stateManager } = appContext.projectContext;

const props = defineProps<{
	sceneId: string;
	sceneTimeMs: number;
	layer: TimelineLayer;
	depth?: number;
	ancestorDisabled?: boolean;
	collapsed?: boolean;
	tlElWidth: number;
	tlRangeX: number;
	tlPosX: number;
	optimizeHorizontalMovement: boolean;
	tickMode: TimelineTickMode;
	tickSubdivisions: TimelineTickSubdivisions;
	mediaInfo: ReadonlyMap<string, TimelineClipMediaInfo>;
	selectedKeyframes: TimelineKeyframeSelection[];
	selectedClipIds: string[];
	selected: boolean;
	moving: boolean;
	isLastOfGroup: boolean;
}>();

const emit = defineEmits<{
	(ev: 'toggleCollapse'): void;
	(ev: 'groupMoveStart', event: PointerEvent): void;
	(ev: 'dragStart', event: DragEvent): void;
	(ev: 'selected', event: MouseEvent): void;
	(ev: 'contextMenu', event: PointerEvent): void;
	(ev: 'addClip', startMs: number): void;
	(ev: 'look', centerTimeMs: number): void;
	(ev: 'clipMoveStart', event: PointerEvent, selection: TimelineClipSelection): void;
	(ev: 'clipTrimStart', event: PointerEvent, selection: TimelineClipSelection, edge: 'start' | 'end'): void;
	(ev: 'keyframeDragStart', event: PointerEvent, selection: TimelineKeyframeSelection): void;
	(ev: 'keyframeSelected', selection: TimelineKeyframeSelection): void;
	(ev: 'subtitleTrimStart', event: PointerEvent, layerId: string, utteranceId: string, clipId: string): void;
}>();

const layerIcon = computed(() => ({ group: 'ti-folder', voicevox: 'ti-microphone', image: 'ti-photo', video: 'ti-video', audio: 'ti-music', scene: 'ti-memory', visualModule: 'ti-chart-dots-3', inlineVisualModule: 'ti-chart-dots-3', effect: 'ti-sparkles', shape: 'ti-shape', text: 'ti-typography' })[props.layer.layerType]);
type Clip = TimelineClip | TimelineAssetClip | TimelineVideoClip | TimelineSceneClip;

const pixelsPerMs = computed(() => props.tlElWidth / props.tlRangeX);
const scrollingStyle = computed(() => ({
	transform: 'translateX(' + (-props.tlPosX * pixelsPerMs.value) + 'px)',
	// クリップ・キー個別ではなく、実際に横移動する親だけを最適化の対象にする。
	willChange: props.optimizeHorizontalMovement ? 'transform' : 'auto',
}));
const groupRange = computed(() => props.layer.layerType === 'group' ? getTimelineGroupRange(props.layer) : null);
const layerClips = computed(() => props.layer.layerType === 'group' ? [] : props.layer.clips);
const sortedClips = computed(() => layerClips.value.toSorted((a, b) => a.startMs - b.startMs));
const clipItems = computed(() => layerClips.value.map(clip => ({ clip, label: clipLabel(clip), sourceDurationMs: sourceDuration(clip) })));
const emptySelectionIds: string[] = [];
const selectedKeyframeIdsByParameter = computed(() => {
	const result = new Map<string, string[]>();
	for (const point of props.selectedKeyframes) {
		if (point.layerId !== props.layer.id) continue;
		const key = JSON.stringify([point.target, point.paramPath]);
		const ids = result.get(key) ?? [];
		ids.push(point.keyframeId);
		result.set(key, ids);
	}
	return result;
});

const offscreenClips = computed(() => {
	const clips = sortedClips.value;
	const viewportEnd = props.tlPosX + props.tlRangeX;
	// 表示中のクリップの有無にかかわらず、左右それぞれの最寄りの画面外クリップを示す。
	// 一部でも見えているクリップは対象にせず、空白を挟んだ先へ移動できるようにする。
	return {
		previous: clips.findLast(clip => getTimelineClipEnd(clip) <= props.tlPosX),
		next: clips.find(clip => clip.startMs >= viewportEnd),
	};
});

function look(clip: TimelineClip) {
	emit('look', clip.startMs + clip.durationMs / 2);
}

function toggleDisabled() {
	stateManager.commit('setTimelineLayerDisabled', {
		sceneId: props.sceneId, layerId: props.layer.id, isDisabled: !props.layer.isDisabled,
	});
}

function clipLabel(clip: Clip): string {
	if ('assetId' in clip) return stateManager.state.assets.value.find(asset => asset.id === clip.assetId)?.name ?? 'Missing media';
	if ('sceneId' in clip) return stateManager.state.timelineScenes.value.find(scene => scene.id === clip.sceneId)?.name ?? 'Missing scene';
	const layer = props.layer;
	if (layer.layerType === 'visualModule') return stateManager.state.visualModules.value.find(module => module.id === layer.visualModuleId)?.name ?? 'Missing module';
	return layer.layerType === 'inlineVisualModule' ? 'Inline Visual Module' : layer.layerType === 'effect' ? effectDefinitions[layer.effectId].displayName : layer.name;
}

function sourceDuration(clip: Clip): number | null {
	if ('assetId' in clip) return props.mediaInfo.get(clip.assetId)?.durationMs ?? null;
	if ('sceneId' in clip) {
		const scene = stateManager.state.timelineScenes.value.find(scene => scene.id === clip.sceneId);
		return scene ? getSceneDuration(scene) : null;
	}
	return null;
}

function onBackgroundDoubleClick(event: MouseEvent) {
	if (props.layer.layerType === 'group' || event.button !== 0 || props.tlElWidth <= 0 || props.tlRangeX <= 0) return;
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
	const startMs = timelinePointerTime(event.clientX, rect.left, props.tlPosX, pixelsPerMs.value);
	if (startMs >= 0) emit('addClip', startMs);
}

type KeyframeParameter = ReturnType<typeof getLayerKeyframeParameters>[number];
const keyframeParameters = computed(() => props.collapsed && props.layer.layerType !== 'group' ? [] : getLayerKeyframeParameters(stateManager.state, props.layer));

// 背景の操作は移動しない表示領域で受け、移動済みDOMのleftを二重に補正しない。
function onKeyframeBackgroundDoubleClick(param: KeyframeParameter, event: MouseEvent) {
	if (event.button !== 0 || props.tlElWidth <= 0 || props.tlRangeX <= 0) return;
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
	const time = timelinePointerTime(event.clientX, rect.left, props.tlPosX, pixelsPerMs.value);
	onKeyframeInsert(param, Math.max(0, time));
}

function onKeyframeInsert(param: KeyframeParameter, x: number) {
	const layer = props.layer;
	const current = resolveLayerParameter(stateManager.state, layer, param.target, param.paramPath).value;
	if (current?.inputSource !== 'keyframesTimelineInline') return;
	const definition = param.def;
	if (!definition) return;
	// キーはクリップの空白にも配置でき、挿入時の値もScene時刻で補間する。
	const inserted = insertInlineKeyframe(current, definition, Math.round(x), Infinity);
	if (!inserted) return;
	if (inserted.value !== current) stateManager.commit('editTimelineLayerParam', {
		sceneId: props.sceneId, layerId: layer.id, target: param.target, paramPath: param.paramPath,
		edit: { kind: 'keyframesTimelineInline', value: inserted.value },
	});
	emit('keyframeSelected', { layerId: layer.id, target: param.target, paramPath: param.paramPath, keyframeId: inserted.keyframeId });
}

// このレイヤーがマウントされ、キーのレーンを表示するときだけローカル目盛りを作る。
const visibleClipTicks = computed(() => props.collapsed || (keyframeParameters.value.length === 0 && props.layer.layerType !== 'voicevox') ? [] : getTimelineVisibleClipTicks(
	layerClips.value, props.tlPosX, props.tlRangeX, getTimelineTickCount(props.tlElWidth), props.tickMode, props.tickSubdivisions,
));

function timeToDomX(time: number): number { return timelineTimeToX(time, props.tlPosX, props.tlRangeX, props.tlElWidth); }
</script>

<style module lang="scss">
.root {
	--mainLaneHeight: 24px;
	--keyframesLaneHeight: 20px;
	--sideColor: #181818;
	overflow: clip;

	&.selected .layerHeader {
		color: var(--THEME-accent);
	}

	&.disabled .tl {
		pointer-events: none;
		opacity: 0.5;
	}

	&:hover {
		.tl {
			background: #ffffff06;
		}
	}

	--LAYER_COLOR: var(--THEME-accent);
	&.type_effect {
		--LAYER_COLOR: var(--THEME-layer-effect);
	}
	&.type_audio {
		--LAYER_COLOR: var(--THEME-layer-audio);
	}
	&.type_image {
		--LAYER_COLOR: var(--THEME-layer-image);
	}
	&.type_video {
		--LAYER_COLOR: var(--THEME-layer-video);
	}
	&.type_text {
		--LAYER_COLOR: var(--THEME-layer-text);
	}
	&.type_voicevox {
		--LAYER_COLOR: var(--THEME-layer-voicevox);
	}
	&.type_group {
		--LAYER_COLOR: var(--THEME-layer-group);
	}
}

.mainLane {
	display: flex;
	width: 100%;
	height: var(--mainLaneHeight);
}

.side {
	display: flex;
	position: relative;
	z-index: 1;
	box-sizing: border-box;
	width: var(--sideWidth);
	flex-shrink: 0;
	background: var(--sideColor);
	direction: ltr;
}

.colorBar {
	width: 3px;
	flex-shrink: 0;
	margin-right: 4px;
	background: var(--LAYER_COLOR);

	&.parentColorBar {
		background: var(--THEME-layer-group);
	}

	&:not(:first-child) {
		margin-left: 8px;
	}
}

.sideBody {
	flex: 1;
	min-width: 0;
}

.tl {
	overflow: clip;
	position: relative;
	flex: 1;
	min-width: 0;
	direction: ltr;
}

.gapLane {
	display: flex;
	width: 100%;
	height: 4px;

	.side {
		background: transparent;
	}
}

.scrollingContent {
	position: absolute;
	inset: 0;
	// 横位置は親で一括更新する。子のクリップ・キーにスクロールを伝播させない。
	overflow: visible;
}

.layerHeader {
	display: flex;
	height: var(--mainLaneHeight);
	line-height: var(--mainLaneHeight);
	align-items: center;
	overflow: clip;
	user-select: none;
	cursor: grab;
	font-size: 90%;
}

.grabber {
	display: grid;
	padding: 4px 4px;
	box-sizing: border-box;
	height: var(--mainLaneHeight);
	cursor: move;
	user-select: none;
	color: color(from currentColor srgb r g b / 0.5);
}

.grabberSvg {
	height: 100%;
	pointer-events: none;
}

.layerHeaderTitle {
	flex: 1;
	min-width: 0;
	overflow: clip;
	text-overflow: ellipsis;
	white-space: nowrap;
	margin-left: 4px;
}

.collapseButton {
	display: flex;
	align-items: center;
	justify-content: center;
	width: var(--mainLaneHeight);
	height: var(--mainLaneHeight);
	color: #fff;
}

.disableButton {
	display: flex;
	align-items: center;
	justify-content: center;
	width: var(--mainLaneHeight);
	height: var(--mainLaneHeight);
	margin-left: 4px;
	color: #fff;

	&.active {
		background: var(--LAYER_COLOR);
		color: #000;
	}
}

.localTicksLane {
	display: flex;
	height: var(--xTicksHeight);
	line-height: var(--xTicksHeight);
	font-size: 12px;
}

.localTicksLabel {
	padding-right: 6px;
	text-align: right;
	color: color-mix(in srgb, var(--THEME-fg) 60%, transparent);
}

.localTicks {
	overflow: clip;
	user-select: none;
}

.localTicksRange {
	position: absolute;
	height: 100%;
	overflow: clip;
}

.localTick {
	position: absolute;
	top: 0;
	height: 100%;
	padding-left: 8px;
	border-left: solid 1px #fff3;
	white-space: nowrap;
	pointer-events: none;
}

.localMinorTick {
	position: absolute;
	bottom: 0;
	height: 4px;
	border-left: solid 1px #fff3;
	pointer-events: none;
}

.speechLane {
	display: flex;
	height: 32px;
	line-height: 32px;
}

.keyframesLane {
	display: flex;
	width: 100%;
	height: var(--keyframesLaneHeight);
	line-height: var(--keyframesLaneHeight);
	text-align: right;

	&:hover {
		background: #ffffff06;
	}
}

.stickyArrow {
	position: absolute;
	z-index: 1;
	top: 0;
	width: var(--mainLaneHeight);
	height: var(--mainLaneHeight);
	line-height: var(--mainLaneHeight);
	text-align: center;
	background: var(--sideColor);
}

.groupClip {
	position: absolute;
	box-sizing: border-box;
	height: var(--mainLaneHeight);
	border-radius: 4px;
	background: color-mix(in srgb, var(--THEME-accent) 20%, transparent);
	color: var(--THEME-fg);
	cursor: grab;
	touch-action: none;
	overflow: clip;
	white-space: nowrap;
	padding: 0 6px;
}

.groupClipSelected {
	background: color-mix(in srgb, var(--THEME-accent) 40%, transparent);
}
</style>
