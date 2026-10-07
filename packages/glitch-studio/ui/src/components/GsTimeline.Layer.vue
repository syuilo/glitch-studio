<template>
<div :class="[$style.root, { [$style.selected]: selected, [$style.disabled]: layer.isDisabled, [$style.type_effect]: layer.layerType === 'effect', [$style.type_audio]: layer.layerType === 'audio', [$style.type_image]: layer.layerType === 'image', [$style.type_video]: layer.layerType === 'video' }]" :data-timeline-layer-id="layer.id">
	<div :class="$style.mainLane" data-timeline-clip-lane>
		<div :class="$style.side">
			<div :class="$style.layerHeader" draggable="true" @click="emit('selected', $event)" @dragstart.stop="emit('dragStart', $event)">
				<i class="ti ti-grip-vertical"></i>
				<i :class="'ti ' + layerIcon"></i>
				<GsCondensedLine style="flex: 1; min-width: 0;">{{ layer.name }}</GsCondensedLine>
				<button class="_button" :class="[$style.disableButton, { [$style.active]: !layer.isDisabled }]" @click.stop="toggleDisabled"><i :class="layer.isDisabled ? 'ti ti-eye-off' : 'ti ti-eye'"></i></button>
			</div>
		</div>
		<div :class="$style.tl" @dblclick.stop.prevent="onBackgroundDoubleClick">
			<button v-if="offscreenClips.previous" class="_button" :class="$style.stickyArrow" style="left: 0;" @click.stop="look(offscreenClips.previous)" @dblclick.stop><i class="ti ti-arrow-left"></i></button>
			<button v-if="offscreenClips.next" class="_button" :class="$style.stickyArrow" style="right: 0;" @click.stop="look(offscreenClips.next)" @dblclick.stop><i class="ti ti-arrow-right"></i></button>
			<div :class="$style.scrollingContent" :style="scrollingStyle">
				<XClips
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
	<div v-if="keyframeParameters.length > 0" :class="$style.localTicksLane">
		<div :class="[$style.side, $style.localTicksLabel]">Clip time</div>
		<div :class="[$style.tl, $style.localTicks]">
			<div v-for="{ clip, ticks } in visibleClipTicks" :key="clip.id" :class="$style.localTicksRange" :style="{ left: timeToDomX(clip.startMs) + 'px', width: clip.durationMs / tlRangeX * tlElWidth + 'px' }">
				<div v-for="tick of ticks.major" :key="tick.contentTimeMs" :class="$style.localTick" class="_monospace" :style="{ left: (tick.sceneTimeMs - clip.startMs) / tlRangeX * tlElWidth + 'px' }">{{ formatTimelineTimecode(tick.contentTimeMs) }}</div>
				<div v-for="tick of ticks.minor" :key="tick.contentTimeMs" :class="$style.localMinorTick" :style="{ left: (tick.sceneTimeMs - clip.startMs) / tlRangeX * tlElWidth + 'px' }"></div>
			</div>
		</div>
	</div>
	<div v-for="param in keyframeParameters" :key="param.key" :class="$style.keyframesLane" :data-parameter-target="param.target" :data-param-path="paramPathKey(param.paramPath)">
		<div :class="$style.side"><div style="padding-right: 10px;">{{ param.label }}</div></div>
		<div :class="$style.tl" @dblclick.stop.prevent="onKeyframeBackgroundDoubleClick(param, $event)">
			<div :class="$style.scrollingContent" :style="scrollingStyle">
				<XKeyframes
					:keyframes="param.binding.keyframesTimeline.keyframes"
					:pixelsPerMs="pixelsPerMs"
					:selectedKeyframeIds="selectedKeyframeIdsByParameter.get(param.key) ?? emptySelectionIds"
					@dragStart="(event, keyframeId) => emit('keyframeDragStart', event, { layerId: layer.id, target: param.target, paramPath: param.paramPath, keyframeId })"
				/>
			</div>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { timelineTimeToX, timelinePointerTime } from '@/utility/timeline-coordinates.ts';
import { paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import { getSceneDuration } from '@gs/subsystems_timeline_shared/scenes.ts';
import { getTimelineClipEnd } from '@gs/subsystems_timeline_shared/timing.ts';
import GsCondensedLine from './common/GsCondensedLine.vue';
import XClips from './GsTimeline.Layer.Clips.vue';
import XKeyframes from './GsTimeline.Layer.Keyframes.vue';
import GsButton from './common/GsButton.vue';
import type { TimelineClip, TimelineAssetClip, TimelineVideoClip, TimelineSceneClip } from '@gs/subsystems_timeline_shared/clip.ts';
import type { TimelineKeyframeSelection, TimelineClipSelection } from '@/utility/timeline-selection.ts';
import type { TimelineTickMode, TimelineTickSubdivisions } from '@/utility/timeline-ticks.ts';
import type { TimelineClipMediaInfo } from '@/utility/timeline-clip-media.ts';
import type { TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { appContext } from '@/app.ts';
import { formatTimelineTimecode, getTimelineVisibleClipTicks, getTimelineTickCount } from '@/utility/timeline-ticks.ts';
import { resolveLayerParameter, getLayerKeyframeParameters } from '@/utility/timeline-scene.ts';
import { insertInlineKeyframe } from '@/utility/keyframes-timeline.ts';

const { stateManager } = appContext.projectContext;

const props = defineProps<{
	sceneId: string;
	sceneTimeMs: number;
	layer: TimelineLayer;
	tlElWidth: number;
	tlRangeX: number;
	tlPosX: number;
	tickMode: TimelineTickMode;
	tickSubdivisions: TimelineTickSubdivisions;
	mediaInfo: ReadonlyMap<string, TimelineClipMediaInfo>;
	selectedKeyframes: TimelineKeyframeSelection[];
	selectedClipIds: string[];
	selected: boolean;
	moving: boolean;
}>();
const emit = defineEmits<{
	(ev: 'dragStart', event: DragEvent): void;
	(ev: 'selected', event: MouseEvent): void;
	(ev: 'addClip', startMs: number): void;
	(ev: 'look', centerTimeMs: number): void;
	(ev: 'clipMoveStart', event: PointerEvent, selection: TimelineClipSelection): void;
	(ev: 'clipTrimStart', event: PointerEvent, selection: TimelineClipSelection, edge: 'start' | 'end'): void;
	(ev: 'keyframeDragStart', event: PointerEvent, selection: TimelineKeyframeSelection): void;
	(ev: 'keyframeSelected', selection: TimelineKeyframeSelection): void;
}>();
const layerIcon = computed(() => ({ image: 'ti-photo', video: 'ti-video', audio: 'ti-music', scene: 'ti-timeline', visualModule: 'ti-chart-dots-3', inlineVisualModule: 'ti-chart-dots-3', effect: 'ti-sparkles', shape: 'ti-shape' })[props.layer.layerType]);
type Clip = TimelineClip | TimelineAssetClip | TimelineVideoClip | TimelineSceneClip;

const pixelsPerMs = computed(() => props.tlElWidth / props.tlRangeX);
const scrollingStyle = computed(() => ({ transform: 'translateX(' + (-props.tlPosX * pixelsPerMs.value) + 'px)' }));
const sortedClips = computed(() => props.layer.clips.toSorted((a, b) => a.startMs - b.startMs));
const clipItems = computed(() => props.layer.clips.map(clip => ({ clip, label: clipLabel(clip), sourceDurationMs: sourceDuration(clip) })));
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
	if (event.button !== 0 || props.tlElWidth <= 0 || props.tlRangeX <= 0) return;
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
	const startMs = timelinePointerTime(event.clientX, rect.left, props.tlPosX, pixelsPerMs.value);
	if (startMs >= 0) emit('addClip', startMs);
}

type KeyframeParameter = ReturnType<typeof getLayerKeyframeParameters>[number];
const keyframeParameters = computed(() => getLayerKeyframeParameters(stateManager.state, props.layer));

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
const visibleClipTicks = computed(() => keyframeParameters.value.length === 0 ? [] : getTimelineVisibleClipTicks(
	props.layer.clips, props.tlPosX, props.tlRangeX, getTimelineTickCount(props.tlElWidth), props.tickMode, props.tickSubdivisions,
));

function timeToDomX(time: number): number { return timelineTimeToX(time, props.tlPosX, props.tlRangeX, props.tlElWidth); }
</script>

<style module lang="scss">
.root {
	--mainLaneHeight: 24px;
	--keyframesLaneHeight: 20px;
	--sideColor: #181818;
	overflow: clip;

	&:hover {
		background: #ffffff06;
	}

	&.selected .layerHeader {
		color: var(--THEME-accent);
	}

	&.disabled .tl {
		pointer-events: none;
		opacity: 0.5;
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
}

.mainLane {
	display: flex;
	width: 100%;
	height: var(--mainLaneHeight);
}

.side {
	position: relative;
	z-index: 1;
	box-sizing: border-box;
	width: var(--sideWidth);
	flex-shrink: 0;
	background: var(--sideColor);
	direction: ltr;
}

.tl {
	overflow: clip;
	position: relative;
	flex: 1;
	min-width: 0;
	direction: ltr;
}

.scrollingContent {
	position: absolute;
	inset: 0;
	// 横位置は親で一括更新する。子のクリップ・キーにスクロールを伝播させない。
	overflow: visible;
}

.layerHeader {
	display: flex;
	gap: 4px;
	height: var(--mainLaneHeight);
	line-height: var(--mainLaneHeight);
	align-items: center;
	overflow: clip;
	user-select: none;
	cursor: grab;
	font-size: 90%;
}

.disableButton {
	display: flex;
	align-items: center;
	justify-content: center;
	width: var(--mainLaneHeight);
	height: var(--mainLaneHeight);
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
	padding-right: 10px;
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
</style>
