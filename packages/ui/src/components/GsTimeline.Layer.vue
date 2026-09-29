<template>
<div :class="$style.root">
	<div :class="$style.side">
		<div :class="$style.sideHeader" draggable="true" @dragstart.stop="emit('dragStart', $event)">
			<i class="ti ti-grip-vertical"></i>
			{{ layerLabel }}
		</div>
		<div v-for="param in keyframeParameters" :key="param.key" :class="$style.sideKeyframesLane">{{ param.key }}</div>
	</div>
	<div :class="$style.tl">
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
		<XKeyframes
			v-for="param in keyframeParameters"
			:key="param.key"
			:keyframes="param.binding.keyframesTimeline.keyframes"
			:startTime="layer.startTimeMs"
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
import { computed, onBeforeUnmount, ref } from 'vue';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { genId } from '@glitch/shared/utility/id.ts';
import { evaluateKeyframesTimeline } from '@glitch/shared/utility/keyframes-timeline.ts';
import GsCondensedLine from './common/GsCondensedLine.vue';
import XKeyframes from './GsTimeline.Layer.Keyframes.vue';
import type { KeyframeMove } from './GsTimeline.Layer.Keyframes.vue';
import type { TimelineLayer } from '@glitch/shared/timeline/types.ts';
import type { ParameterBinding } from '@glitch/shared/types.ts';
import { appStateManager } from '@/app.ts';

const props = defineProps<{
	layer: TimelineLayer;
	tlElWidth: number;
	tlRangeX: number;
	tlPosX: number;
	snapTimes: number[];
	timelineTicks: number[];
	currentTime: number;
	selectedKeyframe: TimelineKeyframeSelection | null;
}>();

const emit = defineEmits<{
	(ev: 'dragStart', event: DragEvent): void;
	(ev: 'selected'): void;
	(ev: 'keyframeSelected', selection: TimelineKeyframeSelection): void;
	(ev: 'snap', time: number | null): void;
}>();

const layerLabel = computed(() => props.layer.layerType === 'audio'
	? `♫ ${appStateManager.state.assets.value.find(asset => asset.id === (props.layer.layerType === 'audio' ? props.layer.assetId : ''))?.name ?? 'Missing audio'}` : props.layer.layerType === 'inlineVisualModule' ? 'Inline Visual Module' : props.layer.id);

const layerRect = computed(() => {
	const left = timeToDomX(props.layer.startTimeMs);
	const width = timeToDomX(props.layer.endTimeMs) - left;
	return { left, width };
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
	for (const target of (props.layer.layerType === 'audio' ? ['audio'] as const : ['compositing', 'module'] as const)) {
		const values = target === 'compositing' && props.layer.layerType !== 'audio' ? props.layer.compositingParamValues : props.layer.paramValues;
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
	startTimeMs: number;
	endTimeMs: number;
	sourceOffsetMs: number;
	msPerPixel: number;
	mergeKey: string;
} | null = null;

function onTimingPointerDown(event: PointerEvent, mode: TimingDragMode) {
	if (event.button !== 0 || timingDrag != null || props.tlElWidth <= 0 || props.tlRangeX <= 0) return;
	const layer = props.layer;
	if (layer.layerType === 'effect') return; // effectレイヤーは未実装。
	event.preventDefault();
	emit('selected');
	const element = event.currentTarget as HTMLElement;
	timingDrag = {
		pointerId: event.pointerId, element, layerId: layer.id, mode, clientX: event.clientX, moved: false,
		startTimeMs: layer.startTimeMs, endTimeMs: layer.endTimeMs,
		sourceOffsetMs: layer.layerType === 'audio' ? layer.sourceOffsetMs : 0,
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
	const layer = appStateManager.state.timeline.value.find(entry => entry.id === drag.layerId);
	if (layer == null) { finishTimingDrag(); return; }
	const rawDelta = (event.clientX - drag.clientX) * drag.msPerPixel;
	// 左端トリムでは音声の読み出し位置も動かすため、素材の先頭より前には伸ばさない。
	const minDelta = drag.mode === 'trimEnd' ? drag.startTimeMs + 1 - drag.endTimeMs
		: drag.mode === 'trimStart' && layer.layerType === 'audio' ? Math.max(-drag.startTimeMs, -drag.sourceOffsetMs)
		: -drag.startTimeMs;
	const maxDelta = drag.mode === 'trimStart' ? drag.endTimeMs - drag.startTimeMs - 1 : Infinity;
	let delta = Math.max(minDelta, Math.min(maxDelta, rawDelta));
	const candidates = [0, ...props.timelineTicks, ...appStateManager.state.timeline.value
		.filter(entry => entry.id !== drag.layerId)
		.flatMap(entry => [entry.startTimeMs, entry.endTimeMs])];
	// 移動時は両端のうち最も近い候補に合わせ、長さを変えずに全体を移動する。
	const edges = drag.mode === 'move' ? [drag.startTimeMs, drag.endTimeMs]
		: [drag.mode === 'trimStart' ? drag.startTimeMs : drag.endTimeMs];
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
	const startTimeMs = drag.startTimeMs + (drag.mode === 'trimEnd' ? 0 : delta);
	const endTimeMs = drag.endTimeMs + (drag.mode === 'trimStart' ? 0 : delta);
	if (layer.startTimeMs === startTimeMs && layer.endTimeMs === endTimeMs) return;
	if (layer.layerType === 'audio') {
		const sourceOffsetMs = drag.sourceOffsetMs + (drag.mode === 'trimStart' ? delta : 0);
		appStateManager.commit('editAudioLayerTiming', { layerId: layer.id, startTimeMs, endTimeMs, sourceOffsetMs }, drag.mergeKey);
	} else if (layer.layerType === 'visualModule' || layer.layerType === 'inlineVisualModule') {
		appStateManager.commit('editVisualModuleLayerTiming', { layerId: layer.id, startTimeMs, endTimeMs }, drag.mergeKey);
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
	return param.binding.keyframesTimeline.keyframes.map(point => ({ parameterKey: param.key, time: props.layer.startTimeMs + point.x }));
}));

function getSnapTimes(param: KeyframeParameter): number[] {
	// 同じ行のキーは子が移動中のキーを除外して候補に加える。
	return [
		...props.snapTimes, props.layer.startTimeMs, props.layer.endTimeMs, props.currentTime,
		...keyframeSnapTimes.value.filter(point => point.parameterKey !== param.key).map(point => point.time),
	];
}

function onKeyframeMove(param: KeyframeParameter, move: KeyframeMove) {
	// コマンドによる置換後のBindingを取得し、子から受け取った移動だけを反映する。
	const layer = appStateManager.state.timeline.value.find(entry => entry.id === props.layer.id);
	if (layer == null) return;
	const values: Partial<Record<string, ParameterBinding>> = param.target === 'compositing' && layer.layerType !== 'audio' ? layer.compositingParamValues : layer.paramValues;
	const current = values[param.paramId];
	if (current?.inputSource !== 'keyframesTimelineInline') return;
	const value = deepClone(current);
	const point = value.keyframesTimeline.keyframes.find(entry => entry.id === move.keyframeId);
	if (point == null || point.x === move.x) return;
	point.x = move.x;
	appStateManager.commit('editTimelineLayerParam', {
		layerId: layer.id, target: param.target, paramId: param.paramId,
		edit: { kind: 'keyframesTimelineInline', value },
	}, move.mergeKey);
}

function onKeyframeInsert(param: KeyframeParameter, x: number) {
	const layer = appStateManager.state.timeline.value.find(entry => entry.id === props.layer.id);
	if (layer == null) return;
	const values: Partial<Record<string, ParameterBinding>> = param.target === 'compositing' && layer.layerType !== 'audio' ? layer.compositingParamValues : layer.paramValues;
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
	const evaluated = evaluateKeyframesTimeline({ ...current, wrapMode: 'clamp' }, x, layer.endTimeMs - layer.startTimeMs, fallback);
	const components = typeof evaluated === 'number' ? [evaluated] : evaluated;
	const keyframeId = genId();
	const value = deepClone(current);
	value.keyframesTimeline.keyframes.push({
		id: keyframeId, x, value: [...components],
		interpolation: deepClone(previous?.interpolation ?? { type: 'linear' }),
	});
	value.keyframesTimeline.keyframes.sort((a, b) => a.x - b.x);
	appStateManager.commit('editTimelineLayerParam', {
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

</script>

<style module lang="scss">
.root {
	--mainLaneHeight: 24px;
	--keyframesLaneHeight: 20px;

	display: flex;
	flex-direction: row;
	width: 100%;
	overflow: clip;
}

.side {
	position: relative;
	z-index: 1;
	box-sizing: border-box;
	width: var(--sideWidth);
	flex-shrink: 0;
	background: #181818;
	direction: ltr;
}

.sideHeader {
	cursor: grab;
	user-select: none;
	gap: 4px;
	height: var(--mainLaneHeight);
	line-height: var(--mainLaneHeight);
	display: flex;
	align-items: center;
}

.sideKeyframesLane {
	height: var(--keyframesLaneHeight);
	line-height: var(--keyframesLaneHeight);
}

.tl {
	position: relative;
	flex: 1;
	direction: ltr;
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
	height: calc(100% - 2px);
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

</style>
