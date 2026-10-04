<template>
<div :class="[$style.root, { [$style.selected]: selected }]" :data-timeline-layer-id="layer.id">
	<div :class="$style.mainLane">
		<div :class="$style.side">
			<div :class="$style.layerHeader" draggable="true" @click="emit('selected', $event)" @dragstart.stop="emit('dragStart', $event)">
				<i class="ti ti-grip-vertical"></i>
				<i :class="'ti ' + layerIcon"></i>
				<GsCondensedLine style="flex: 1; min-width: 0;">{{ layer.name }}</GsCondensedLine>
				<GsButton iconOnly :primary="!layer.isDisabled" @click=""><i class="ti ti-eye"></i></GsButton>
			</div>
		</div>
		<div :class="$style.tl" @dblclick.stop.prevent="onBackgroundDoubleClick">
			<button v-if="offscreenClips.previous" class="_button" :class="$style.stickyArrow" style="left: 0;" @click.stop="look(offscreenClips.previous)" @dblclick.stop><i class="ti ti-arrow-left"></i></button>
			<button v-if="offscreenClips.next" class="_button" :class="$style.stickyArrow" style="right: 0;" @click.stop="look(offscreenClips.next)" @dblclick.stop><i class="ti ti-arrow-right"></i></button>
			<XClip
				v-for="clip in layer.clips"
				:key="clip.id"
				:clip="clip"
				:label="clipLabel(clip)"
				:sourceDurationMs="sourceDuration(clip)"
				:tlElWidth="tlElWidth"
				:tlRangeX="tlRangeX"
				:tlPosX="tlPosX"
				:selected="selectedClipIds.includes(clip.id)"
				:moving="moving && selectedClipIds.includes(clip.id)"
				@moveStart="event => emit('clipMoveStart', event, { layerId: layer.id, clipId: clip.id })"
				@trimStart="(event, edge) => emit('clipTrimStart', event, { layerId: layer.id, clipId: clip.id }, edge)"
			/>
		</div>
	</div>
	<div v-if="keyframeParameters.length > 0" :class="$style.localTicksLane">
		<div :class="[$style.side, $style.localTicksLabel]">Clip time</div>
		<div :class="[$style.tl, $style.localTicks]">
			<div v-for="clip in layer.clips" :key="clip.id" :class="$style.localTicksRange" :style="{ left: timeToDomX(clip.startMs) + 'px', width: clip.durationMs / tlRangeX * tlElWidth + 'px' }">
				<div v-for="tick of clipTicks.get(clip.id)?.major" :key="tick.contentTimeMs" :class="$style.localTick" class="_monospace" :style="{ left: (tick.sceneTimeMs - clip.startMs) / tlRangeX * tlElWidth + 'px' }">{{ formatTimelineTimecode(tick.contentTimeMs) }}</div>
				<div v-for="tick of clipTicks.get(clip.id)?.minor" :key="tick.contentTimeMs" :class="$style.localMinorTick" :style="{ left: (tick.sceneTimeMs - clip.startMs) / tlRangeX * tlElWidth + 'px' }"></div>
			</div>
		</div>
	</div>
	<div v-for="param in keyframeParameters" :key="param.key" :class="$style.keyframesLane" :data-parameter-target="param.target" :data-param-path="paramPathKey(param.paramPath)">
		<div :class="$style.side"><div style="padding-right: 10px;">{{ param.label }}</div></div>
		<div :class="$style.tl">
			<XKeyframes
				:keyframes="param.binding.keyframesTimeline.keyframes"
				:startTime="0"
				:tlElWidth="tlElWidth"
				:tlRangeX="tlRangeX"
				:tlPosX="tlPosX"
				:selectedKeyframeIds="selectedKeyframes.filter(point => point.layerId === layer.id && point.target === param.target && paramPathKey(point.paramPath) === paramPathKey(param.paramPath)).map(point => point.keyframeId)"
				@dragStart="(event, keyframeId) => emit('keyframeDragStart', event, { layerId: layer.id, target: param.target, paramPath: param.paramPath, keyframeId })"
				@insert="onKeyframeInsert(param, $event)"
			/>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import { getSceneDuration } from '@gs/subsystems_timeline_shared/scenes.ts';
import { getTimelineClipEnd } from '@gs/subsystems_timeline_shared/timing.ts';
import GsCondensedLine from './common/GsCondensedLine.vue';
import XClip from './GsTimeline.Clip.vue';
import XKeyframes from './GsTimeline.Layer.Keyframes.vue';
import GsButton from './common/GsButton.vue';
import type { TimelineClip, TimelineAssetClip, TimelineVideoClip, TimelineSceneClip } from '@gs/subsystems_timeline_shared/clip.ts';
import type { TimelineKeyframeSelection, TimelineClipSelection } from '@/utility/timeline-selection.ts';
import type { TimelineClipTicks } from '@/utility/timeline-ticks.ts';
import type { TimelineClipMediaInfo } from '@/utility/timeline-clip-media.ts';
import type { TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { formatTimelineTimecode } from '@/utility/timeline-ticks.ts';
import { resolveLayerParameter, getLayerKeyframeParameters } from '@/utility/timeline-scene.ts';
import { appStateManager } from '@/app.ts';
import { insertInlineKeyframe } from '@/utility/keyframes-timeline.ts';

const props = defineProps<{
	sceneId: string;
	layer: TimelineLayer;
	tlElWidth: number;
	tlRangeX: number;
	tlPosX: number;
	clipTicks: ReadonlyMap<string, TimelineClipTicks>;
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
const layerIcon = computed(() => ({ image: 'ti-photo', video: 'ti-video', audio: 'ti-music', scene: 'ti-timeline', visualModule: 'ti-chart-dots-3', inlineVisualModule: 'ti-chart-dots-3', effect: 'ti-sparkles' })[props.layer.layerType]);
type Clip = TimelineClip | TimelineAssetClip | TimelineVideoClip | TimelineSceneClip;

const offscreenClips = computed(() => {
	const clips = props.layer.clips.toSorted((a, b) => a.startMs - b.startMs);
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

function clipLabel(clip: Clip): string {
	if ('assetId' in clip) return appStateManager.state.assets.value.find(asset => asset.id === clip.assetId)?.name ?? 'Missing media';
	if ('sceneId' in clip) return appStateManager.state.timelineScenes.value.find(scene => scene.id === clip.sceneId)?.name ?? 'Missing scene';
	const layer = props.layer;
	if (layer.layerType === 'visualModule') return appStateManager.state.visualModules.value.find(module => module.id === layer.visualModuleId)?.name ?? 'Missing module';
	return layer.layerType === 'inlineVisualModule' ? 'Inline Visual Module' : layer.layerType === 'effect' ? effectDefinitions[layer.effectId].displayName : layer.name;
}

function sourceDuration(clip: Clip): number | null {
	if ('assetId' in clip) return props.mediaInfo.get(clip.assetId)?.durationMs ?? null;
	if ('sceneId' in clip) {
		const scene = appStateManager.state.timelineScenes.value.find(scene => scene.id === clip.sceneId);
		return scene ? getSceneDuration(scene) : null;
	}
	return null;
}

function onBackgroundDoubleClick(event: MouseEvent) {
	if (event.button !== 0 || props.tlElWidth <= 0 || props.tlRangeX <= 0) return;
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
	const startMs = props.tlPosX + (event.clientX - rect.left) / props.tlElWidth * props.tlRangeX;
	if (startMs >= 0) emit('addClip', startMs);
}

type KeyframeParameter = ReturnType<typeof getLayerKeyframeParameters>[number];
const keyframeParameters = computed(() => getLayerKeyframeParameters(appStateManager.state, props.layer));

function onKeyframeInsert(param: KeyframeParameter, x: number) {
	const layer = props.layer;
	const current = resolveLayerParameter(appStateManager.state, layer, param.target, param.paramPath).value;
	if (current?.inputSource !== 'keyframesTimelineInline') return;
	const definition = param.def;
	if (!definition) return;
	// キーはクリップの空白にも配置でき、挿入時の値もScene時刻で補間する。
	const inserted = insertInlineKeyframe(current, definition, Math.round(x), Infinity);
	if (!inserted) return;
	if (inserted.value !== current) appStateManager.commit('editTimelineLayerParam', {
		sceneId: props.sceneId, layerId: layer.id, target: param.target, paramPath: param.paramPath,
		edit: { kind: 'keyframesTimelineInline', value: inserted.value },
	});
	emit('keyframeSelected', { layerId: layer.id, target: param.target, paramPath: param.paramPath, keyframeId: inserted.keyframeId });
}

function timeToDomX(time: number): number { return (time - props.tlPosX) / props.tlRangeX * props.tlElWidth; }
</script>

<style module lang="scss">
.root {
	--mainLaneHeight: 24px;
	--keyframesLaneHeight: 20px;
	--sideColor: #181818;
	overflow: clip;
	&:hover { background: #ffffff06; }
	&.selected .layerHeader { color: var(--THEME-accent); }
}
.mainLane { display: flex; width: 100%; height: var(--mainLaneHeight); }
.side { position: relative; z-index: 1; box-sizing: border-box; width: var(--sideWidth); flex-shrink: 0; background: var(--sideColor); direction: ltr; }
.tl { position: relative; flex: 1; min-width: 0; direction: ltr; }
.layerHeader { display: flex; gap: 4px; height: var(--mainLaneHeight); line-height: var(--mainLaneHeight); align-items: center; overflow: clip; user-select: none; cursor: grab; font-size: 90%; }
.localTicksLane { display: flex; height: var(--xTicksHeight); line-height: var(--xTicksHeight); font-size: 12px; }
.localTicksLabel { padding-right: 10px; text-align: right; color: color-mix(in srgb, var(--THEME-fg) 60%, transparent); }
.localTicks { overflow: clip; user-select: none; }
.localTicksRange { position: absolute; height: 100%; overflow: clip; }
.localTick { position: absolute; top: 0; height: 100%; padding-left: 8px; border-left: solid 1px #fff3; white-space: nowrap; pointer-events: none; }
.localMinorTick { position: absolute; bottom: 0; height: 4px; border-left: solid 1px #fff3; pointer-events: none; }
.keyframesLane { display: flex; width: 100%; height: var(--keyframesLaneHeight); line-height: var(--keyframesLaneHeight); text-align: right; &:hover { background: #ffffff06; } }
.stickyArrow { position: absolute; z-index: 1; top: 0; width: var(--mainLaneHeight); height: var(--mainLaneHeight); line-height: var(--mainLaneHeight); text-align: center; background: var(--sideColor); }
</style>
