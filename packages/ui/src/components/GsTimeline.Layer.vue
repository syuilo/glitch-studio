<template>
<div :class="[$style.root, { [$style.selected]: selected }]" @click="emit('selected')">
	<div :class="$style.mainLane">
		<div :class="$style.side">
			<div :class="$style.layerHeader" draggable="true" @dragstart.stop="emit('dragStart', $event)">
				<span style="font-size: 85%; color: color-mix(in srgb, var(--THEME-fg), var(--sideColor) 50%);">
					<i class="ti ti-grip-vertical"></i>
				</span>
				<span style="font-size: 90%;">
					<i v-if="layer.layerType === 'visualModule'" class="ti ti-chart-dots-3"></i>
					<i v-else-if="layer.layerType === 'inlineVisualModule'" class="ti ti-chart-dots-3"></i>
					<i v-else-if="layer.layerType === 'scene'" class="ti ti-timeline"></i>
					<i v-else-if="layer.layerType === 'video'" class="ti ti-video"></i>
					<i v-else-if="layer.layerType === 'audio'" class="ti ti-music"></i>
				</span>
				<span style="flex: 1; min-width: 0;">
					<GsCondensedLine>{{ layerLabel }}</GsCondensedLine>
				</span>
			</div>
		</div>
		<div :class="$style.tl">
			<div v-if="sourceRect" :class="$style.tlSourceGhost" :style="{ left: sourceRect.left + 'px', width: sourceRect.width + 'px' }"></div>
			<button v-show="layerRect.left > tlElWidth" class="_button" :class="$style.stickyArrow" :style="{ right: 0 }" @click="look"><i class="ti ti-arrow-right"></i></button>
			<button v-show="layerRect.left + layerRect.width < 0" class="_button" :class="$style.stickyArrow" :style="{ left: 0 }" @click="look"><i class="ti ti-arrow-left"></i></button>
			<div
				:class="[$style.tlClip, { [$style.moving]: timingDragMode === 'move' }]"
				:style="{ width: layerRect.width + 'px', left: layerRect.left + 'px' }"
				@pointerdown.stop="onTimingPointerDown($event, 'move')"
				@pointermove="onTimingPointerMove"
				@pointerup="onTimingPointerUp"
				@pointercancel="onTimingPointerCancel"
				@lostpointercapture="onTimingPointerCancel"
				@click.stop="onLayerClipClick"
			>
				<div :class="$style.tlClipInner">
					<GsCondensedLine>{{ layerLabel }}</GsCondensedLine>
					<div :class="[$style.trimHandle, $style.trimStart]" @pointerdown.stop="onTimingPointerDown($event, 'trimStart')"></div>
					<div :class="[$style.trimHandle, $style.trimEnd]" @pointerdown.stop="onTimingPointerDown($event, 'trimEnd')"></div>
				</div>
			</div>
		</div>
	</div>
	<div v-for="param in keyframeParameters" :key="param.key" :class="$style.keyframesLane">
		<div :class="$style.side">
			<div style="padding: 0 10px 0 0;">
				{{ param.key }}
			</div>
		</div>
		<div :class="$style.tl">
			<div style="position: relative;">
				<XKeyframes
					:keyframes="param.binding.keyframesTimeline.keyframes"
					:startTime="layer.positionMs"
					:tlElWidth="tlElWidth"
					:tlRangeX="tlRangeX"
					:tlPosX="tlPosX"
					:snapTimes="getSnapTimes(param)"
					:selectedKeyframeId="selectedKeyframe?.layerId === layer.id && selectedKeyframe.target === param.target && selectedKeyframe.paramId === param.paramId ? selectedKeyframe.keyframeId : null"
					@select="keyframeId => emit('keyframeSelected', { layerId: layer.id, target: param.target, paramId: param.paramId, keyframeId })"
					@move="onKeyframeMove(param, $event)"
					@insert="onKeyframeInsert(param, $event)"
					@snap="emit('snap', $event)"
				/>
			</div>
		</div>
	</div>
</div>
</template>

<script lang="ts">
export type TimelineKeyframeSelection = {
	layerId: string;
	target: 'compositing' | 'module' | 'audio';
	paramId: string;
	keyframeId: string;
};
</script>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { genId } from '@glitch/shared/utility/id.ts';
import { evaluateKeyframesTimeline } from '@glitch/shared/utility/keyframes-timeline.ts';
import { getTimelineLayerStart, getTimelineLayerEnd } from '@glitch/shared/timeline/timing.ts';
import { getSceneDuration } from '@glitch/shared/timeline/scenes.ts';
import { readMediaMetadata } from '@glitch/shared/media/media-metadata.ts';
import GsCondensedLine from './common/GsCondensedLine.vue';
import XKeyframes from './GsTimeline.Layer.Keyframes.vue';
import type { KeyframeMove } from './GsTimeline.Layer.Keyframes.vue';
import type { TimelineLayer } from '@glitch/shared/timeline/types.ts';
import type { ParameterBinding } from '@glitch/shared/types.ts';
import { getLayerParameterValues } from '@/utility/timeline-scene.ts';
import { appStateManager } from '@/app.ts';
import { openAssetAudio } from '@/audio/asset-audio-reader.ts';

const props = defineProps<{
	sceneId: string;
	layer: TimelineLayer;
	tlElWidth: number;
	tlRangeX: number;
	tlPosX: number;
	snapTimes: number[];
	timelineTicks: number[];
	currentTime: number;
	selectedKeyframe: TimelineKeyframeSelection | null;
	selected: boolean;
}>();

const sceneLayers = computed(() => appStateManager.state.timelineScenes.value.find(scene => scene.id === props.sceneId)?.layers ?? []);

const emit = defineEmits<{
	(ev: 'update:tlPosX', value: number): void;
	(ev: 'dragStart', event: DragEvent): void;
	(ev: 'selected'): void;
	(ev: 'keyframeSelected', selection: TimelineKeyframeSelection): void;
	(ev: 'snap', time: number | null): void;
}>();

const layerLabel = computed(() => props.layer.layerType === 'scene' ? appStateManager.state.timelineScenes.value.find(scene => scene.id === (props.layer.layerType === 'scene' ? props.layer.sceneId : ''))?.name ?? 'Missing scene' : (props.layer.layerType === 'audio' || props.layer.layerType === 'video')
	? `${appStateManager.state.assets.value.find(asset => asset.id === ((props.layer.layerType === 'audio' || props.layer.layerType === 'video') ? props.layer.assetId : ''))?.name ?? 'Missing media'}` : props.layer.layerType === 'inlineVisualModule' ? 'Inline Visual Module' : props.layer.id);

const mediaAsset = computed(() => {
	const layer = props.layer;
	return (layer.layerType === 'audio' || layer.layerType === 'video') ? appStateManager.state.assets.value.find(asset => asset.id === layer.assetId) : undefined;
});
const contentDurationMs = ref<number | null>(null);
watch(() => mediaAsset.value?.fileData, async (_, __, onCleanup) => {
	const asset = mediaAsset.value;
	contentDurationMs.value = null;
	let cancelled = false;
	onCleanup(() => { cancelled = true; });
	if (asset == null) return;
	try {
		if (props.layer.layerType === 'video') {
			const metadata = await readMediaMetadata(asset.fileData);
			if (!cancelled) contentDurationMs.value = metadata.durationMs;
			return;
		}
		const audio = await openAssetAudio(asset);
		try {
			const durationMs = audio.duration * 1000;
			if (!cancelled && Number.isFinite(durationMs) && durationMs > 0) contentDurationMs.value = durationMs;
		} finally {
			audio.input.dispose();
		}
	} catch {
		// 素材を読めない場合は長さを推測せず、ゴーストだけを非表示にする。
	}
}, { immediate: true });

const layerRect = computed(() => {
	const left = timeToDomX(getTimelineLayerStart(props.layer));
	const width = timeToDomX(getTimelineLayerEnd(props.layer)) - left;
	return { left, width };
});

const sourceRect = computed(() => {
	if (props.layer.layerType === 'scene') {
		const scene = appStateManager.state.timelineScenes.value.find(scene => scene.id === (props.layer.layerType === 'scene' ? props.layer.sceneId : ''));
		return scene == null ? null : { left: timeToDomX(props.layer.positionMs), width: getSceneDuration(scene) / props.tlRangeX * props.tlElWidth };
	}
	if ((props.layer.layerType !== 'audio' && props.layer.layerType !== 'video') || contentDurationMs.value == null) return null;
	return { left: timeToDomX(props.layer.positionMs), width: contentDurationMs.value / props.tlRangeX * props.tlElWidth };
});

type InlineKeyframesTimeline = Extract<ParameterBinding, { inputSource: 'keyframesTimelineInline' }>;
type KeyframeParameter = {
	key: string;
	paramId: string;
	target: 'compositing' | 'module' | 'audio';
	binding: InlineKeyframesTimeline;
};

const keyframeParameters = computed(() => {
	const res: KeyframeParameter[] = [];
	for (const target of (props.layer.layerType === 'audio' ? ['audio'] as const : (props.layer.layerType === 'scene' || props.layer.layerType === 'video') ? ['compositing', 'audio'] as const : ['compositing', 'module'] as const)) {
		const values = getLayerParameterValues(props.layer, target);
		for (const [paramId, binding] of Object.entries(values)) {
			if (binding.inputSource !== 'keyframesTimelineInline') continue;
			res.push({ key: `${target}:${paramId}`, paramId, target, binding });
		}
	}
	return res;
});

type TimingDragMode = 'move' | 'trimStart' | 'trimEnd';
const timingDragMode = ref<TimingDragMode | null>(null);
let timingDrag: {
	pointerId: number;
	element: HTMLElement;
	layerId: string;
	mode: TimingDragMode;
	clientX: number;
	moved: boolean;
	positionMs: number;
	trimmedDurationMs: number;
	trimStartMs: number;
	msPerPixel: number;
	mergeKey: string;
} | null = null;

function onTimingPointerDown(event: PointerEvent, mode: TimingDragMode) {
	if (event.button !== 0 || timingDrag != null || props.tlElWidth <= 0 || props.tlRangeX <= 0) return;
	const layer = props.layer;
	if (layer.layerType === 'effect' || (layer.layerType === 'video' && contentDurationMs.value == null)) return; // effectレイヤーは未実装。
	event.preventDefault();
	emit('selected');
	const element = event.currentTarget as HTMLElement;
	timingDrag = {
		pointerId: event.pointerId, element, layerId: layer.id, mode, clientX: event.clientX, moved: false,
		positionMs: layer.positionMs, trimmedDurationMs: layer.trimmedDurationMs,
		trimStartMs: layer.trimStartMs,
		msPerPixel: props.tlRangeX / props.tlElWidth, mergeKey: genId(),
	};
	timingDragMode.value = mode;
	element.setPointerCapture(event.pointerId);
	window.addEventListener('blur', finishTimingDrag);
}

function onTimingPointerMove(event: PointerEvent) {
	const drag = timingDrag;
	if (drag == null || event.pointerId !== drag.pointerId) return;
	// 選択のクリックだけで付近の目盛へ吸着して時刻が変わらないようにする。
	if (!drag.moved && Math.abs(event.clientX - drag.clientX) < 3) return;
	drag.moved = true;
	const layer = sceneLayers.value.find(entry => entry.id === drag.layerId);
	if (layer == null) { finishTimingDrag(); return; }
	const rawDelta = (event.clientX - drag.clientX) * drag.msPerPixel;
	const playbackStartMs = drag.positionMs + drag.trimStartMs;
	// 左端トリムでは音声の読み出し位置も動かすため、素材の先頭より前には伸ばさない。
	const minDelta = drag.mode === 'trimEnd' ? 1 - drag.trimmedDurationMs
		: drag.mode === 'trimStart' && (layer.layerType === 'audio' || layer.layerType === 'scene' || layer.layerType === 'video') ? Math.max(-playbackStartMs, -drag.trimStartMs)
		: -playbackStartMs;
	const maxDelta = drag.mode === 'trimStart' ? drag.trimmedDurationMs - 1
		: drag.mode === 'trimEnd' && (layer.layerType === 'audio' || layer.layerType === 'video') && contentDurationMs.value != null
			? Math.max(0, contentDurationMs.value - drag.trimStartMs - drag.trimmedDurationMs) : Infinity;
	let delta = Math.max(minDelta, Math.min(maxDelta, rawDelta));
	const candidates = [0, ...props.timelineTicks, ...sceneLayers.value
		.filter(entry => entry.id !== drag.layerId)
		.flatMap(entry => [getTimelineLayerStart(entry), getTimelineLayerEnd(entry)])];
	// 移動時は両端のうち最も近い候補に合わせ、長さを変えずに全体を移動する。
	const edges = drag.mode === 'move' ? [playbackStartMs, playbackStartMs + drag.trimmedDurationMs]
		: [drag.mode === 'trimStart' ? playbackStartMs : playbackStartMs + drag.trimmedDurationMs];
	let nearestDistance = 5;
	let snappingTime: number | null = null;
	for (const edge of edges) {
		for (const time of candidates) {
			const candidateDelta = time - edge;
			if (candidateDelta < minDelta || candidateDelta > maxDelta) continue;
			const distance = Math.abs(candidateDelta - rawDelta) / drag.msPerPixel;
			if (distance >= nearestDistance) continue;
			nearestDistance = distance;
			delta = candidateDelta;
			snappingTime = time;
		}
	}
	emit('snap', snappingTime);
	// 音声のpositionMsは素材の配置基準。左端のトリムでは基準を動かさず、
	// trimStartMsとtrimmedDurationMsを逆方向へ変更して右端を保つ。
	const positionMs = drag.positionMs + (drag.mode === 'move' || (drag.mode === 'trimStart' && layer.layerType !== 'audio' && layer.layerType !== 'scene' && layer.layerType !== 'video') ? delta : 0);
	const trimmedDurationMs = drag.trimmedDurationMs + (drag.mode === 'move' ? 0 : drag.mode === 'trimStart' ? -delta : delta);
	if (layer.positionMs === positionMs && layer.trimmedDurationMs === trimmedDurationMs) return;
	if (layer.layerType === 'audio' || layer.layerType === 'scene' || layer.layerType === 'video') {
		const trimStartMs = drag.trimStartMs + (drag.mode === 'trimStart' ? delta : 0);
		if (layer.layerType === 'video') {
			const sourceDurationMs = contentDurationMs.value;
			if (sourceDurationMs == null || trimStartMs + trimmedDurationMs > sourceDurationMs) return;
			appStateManager.commit('editVideoLayerTiming', { sceneId: props.sceneId, layerId: layer.id, positionMs, trimmedDurationMs, trimStartMs, sourceDurationMs }, drag.mergeKey);
		} else {
			appStateManager.commit(layer.layerType === 'scene' ? 'editSceneLayerTiming' : 'editAudioLayerTiming', { sceneId: props.sceneId, layerId: layer.id, positionMs, trimmedDurationMs, trimStartMs }, drag.mergeKey);
		}
	} else if (layer.layerType === 'visualModule' || layer.layerType === 'inlineVisualModule') {
		appStateManager.commit('editVisualModuleLayerTiming', { sceneId: props.sceneId, layerId: layer.id, positionMs, trimmedDurationMs }, drag.mergeKey);
	}
}

function onTimingPointerUp(event: PointerEvent) {
	if (timingDrag?.pointerId !== event.pointerId) return;
	onTimingPointerMove(event);
	finishTimingDrag();
}

function onTimingPointerCancel(event: PointerEvent) {
	if (timingDrag?.pointerId !== event.pointerId) return;
	finishTimingDrag();
}

function finishTimingDrag() {
	const drag = timingDrag;
	if (drag == null) return;
	timingDrag = null;
	timingDragMode.value = null;
	emit('snap', null);
	window.removeEventListener('blur', finishTimingDrag);
	if (drag.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
}

onBeforeUnmount(finishTimingDrag);

const keyframeSnapTimes = computed(() => keyframeParameters.value.flatMap(param => {
	return param.binding.keyframesTimeline.keyframes.map(point => ({ parameterKey: param.key, time: props.layer.positionMs + point.x }));
}));

function getSnapTimes(param: KeyframeParameter): number[] {
	// 同じ行のキーは子が移動中のキーを除外して候補に加える。
	return [
		...props.snapTimes, getTimelineLayerStart(props.layer), getTimelineLayerEnd(props.layer), props.currentTime,
		...keyframeSnapTimes.value.filter(point => point.parameterKey !== param.key).map(point => point.time),
	];
}

function onKeyframeMove(param: KeyframeParameter, move: KeyframeMove) {
	// コマンドによる置換後のBindingを取得し、子から受け取った移動だけを反映する。
	const layer = sceneLayers.value.find(entry => entry.id === props.layer.id);
	if (layer == null) return;
	const values: Partial<Record<string, ParameterBinding>> = getLayerParameterValues(layer, param.target);
	const current = values[param.paramId];
	if (current?.inputSource !== 'keyframesTimelineInline') return;
	const value = deepClone(current);
	const point = value.keyframesTimeline.keyframes.find(entry => entry.id === move.keyframeId);
	if (point == null || point.x === move.x) return;
	point.x = move.x;
	appStateManager.commit('editTimelineLayerParam', {
		sceneId: props.sceneId,
		layerId: layer.id, target: param.target, paramId: param.paramId,
		edit: { kind: 'keyframesTimelineInline', value },
	}, move.mergeKey);
}

function onKeyframeInsert(param: KeyframeParameter, x: number) {
	const layer = sceneLayers.value.find(entry => entry.id === props.layer.id);
	if (layer == null) return;
	const values: Partial<Record<string, ParameterBinding>> = getLayerParameterValues(layer, param.target);
	const current = values[param.paramId];
	if (current?.inputSource !== 'keyframesTimelineInline') return;
	const keyframes = current.keyframesTimeline.keyframes.toSorted((a, b) => a.x - b.x);
	const previous = keyframes.findLast(point => point.x <= x);
	if (previous?.x === x) {
		emit('keyframeSelected', { layerId: layer.id, target: param.target, paramId: param.paramId, keyframeId: previous.id });
		return;
	}
	const kind = current.keyframesTimeline.dataType.kind;
	const fallback = Array<number>(kind === 'scalar' ? 1 : kind === 'vector' ? 2 : 4).fill(0);
	// 挿入は元の区間を分割する操作。区間外では再生時の繰り返しを適用せず端の値を使う。
	// 終端合わせのキーも再生時と同じ基準で評価する。素材の長さが未取得なら挿入を待つ。
	const endTimeMs = (layer.layerType === 'audio' || (layer.layerType === 'video' && param.target === 'audio')) ? contentDurationMs.value : layer.trimStartMs + layer.trimmedDurationMs;
	if (endTimeMs == null) return;
	const evaluated = evaluateKeyframesTimeline({ ...current, wrapMode: 'clamp' }, x, endTimeMs, fallback);
	const components = typeof evaluated === 'number' ? [evaluated] : evaluated;
	const keyframeId = genId();
	const value = deepClone(current);
	value.keyframesTimeline.keyframes.push({
		id: keyframeId, x, value: [...components],
		interpolation: deepClone(previous?.interpolation ?? { type: 'linear' }),
	});
	value.keyframesTimeline.keyframes.sort((a, b) => a.x - b.x);
	appStateManager.commit('editTimelineLayerParam', {
		sceneId: props.sceneId,
		layerId: layer.id, target: param.target, paramId: param.paramId,
		edit: { kind: 'keyframesTimelineInline', value },
	});
	emit('keyframeSelected', { layerId: layer.id, target: param.target, paramId: param.paramId, keyframeId });
}

function timeToDomX(time: number): number {
	return ((time - props.tlPosX) / props.tlRangeX) * props.tlElWidth;
}

function onLayerClipClick() {
	emit('selected');
}

function look() {
	const start = getTimelineLayerStart(props.layer);
	const end = getTimelineLayerEnd(props.layer);
	emit('update:tlPosX', (start + end) / 2 - props.tlRangeX / 2);
}

</script>

<style module lang="scss">
.root {
	--mainLaneHeight: 24px;
	--keyframesLaneHeight: 20px;
	--sideColor: #181818;

	overflow: clip;

	&:hover {
		background: #ffffff06;

		.side {
			background: hsl(from var(--sideColor) h s calc(l + 2));
		}
	}

	&.selected {
		.layerHeader {
			color: var(--THEME-accent);
		}
	}
}

.mainLane {
	display: flex;
	flex-direction: row;
	width: 100%;
}

.keyframesLane {
	display: flex;
	flex-direction: row;
	width: 100%;
	height: var(--keyframesLaneHeight);
	line-height: var(--keyframesLaneHeight);
	text-align: right;

	&:hover {
		background: #ffffff06;

		.side {
			background: hsl(from var(--sideColor) h s calc(l + 8));
		}
	}
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
	position: relative;
	flex: 1;
	direction: ltr;
}

.tlSourceGhost {
	position: absolute;
	//top: 1px;
	//height: calc(var(--mainLaneHeight) - 2px);
	height: var(--mainLaneHeight);
	box-sizing: border-box;
	background: color-mix(in srgb, var(--THEME-accent) 15%, transparent);
	border: 1px dashed color-mix(in srgb, var(--THEME-accent) 45%, transparent);
	pointer-events: none;
}

.tlClip {
	position: relative;
	height: var(--mainLaneHeight);
	box-sizing: border-box;
	overflow: clip;
	cursor: grab;
	touch-action: none;
	user-select: none;
}

.tlClipInner {
	position: absolute;
	margin: auto 0;
	top: 0;
	bottom: 0;
	//height: calc(100% - 2px);
	width: 100%;
	padding: 0 8px 0 8px;
	box-sizing: border-box;
	//background: linear-gradient(0deg, hsl(from var(--THEME-accent) h calc(s + 20) calc(l - 10)), hsl(from var(--THEME-accent) h s calc(l + 10)));
	background: var(--THEME-accent);
	color: var(--THEME-fgOnAccent);
	border-radius: 8px 0 0 0;
	corner-shape: bevel;
}

.moving {
	cursor: grabbing;
}

.trimHandle {
	position: absolute;
	top: 0;
	bottom: 0;
	width: min(8px, 25%);
	cursor: ew-resize;
	touch-action: none;
	//background: color-mix(in srgb, var(--THEME-fgOnAccent) 20%, transparent);

	&:hover {
		background: #fff8;
	}
}

.trimStart {
	left: 0;
}

.trimEnd {
	right: 0;
}

.layerHeader {
	gap: 4px;
	height: var(--mainLaneHeight);
	line-height: var(--mainLaneHeight);
	display: flex;
	align-items: center;
	overflow: clip;
	user-select: none;
	cursor: grab;
}

.stickyArrow {
	position: absolute;
	top: 0;
	width: var(--mainLaneHeight);
	height: var(--mainLaneHeight);
	line-height: var(--mainLaneHeight);
	text-align: center;
}

</style>
