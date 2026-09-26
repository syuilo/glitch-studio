<template>
<div :class="$style.root">
	<div :class="$style.side">
		<div :class="$style.sideHeader">{{ layer.id }}</div>
		<div v-for="param in keyframeParameters" :key="param.key" :class="$style.sideKeyframesRow">{{ param.key }}</div>
	</div>
	<div :class="$style.tl">
		<div v-if="snappingTime != null" :class="$style.snapLine" :style="{ left: timeToDomX(snappingTime) + 'px' }"></div>
		<div :class="$style.tlBlock" :style="{ width: layerRect.width + 'px', left: layerRect.left + 'px' }" @click="onLayerBlockClick">{{ layer.id }}</div>
		<div v-for="param in keyframeParameters" :key="param.key" :class="$style.tlKeyframesRow">
			<div
				v-for="keyframe of param.binding.keyframesTimeline.keyframes"
				:key="keyframe.id"
				:class="$style.tlKeyframe"
				:style="{ left: timeToDomX(keyframeTime(param.binding, keyframe.x)) + 'px' }"
				@mousedown.stop.prevent="onKeyframeMousedown($event, param, keyframe.id)"
			>
			</div>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { genId } from '@glitch/shared/utility/id.ts';
import { visualModuleCustomParameterId } from '@glitch/shared/visual-module/types.ts';
import type { TimelineLayer } from '@glitch/shared/timeline/types.ts';
import type { ParameterBinding } from '@glitch/shared/types.ts';
import { appContext } from '@/app.ts';
import { dragListen } from '@/utility/drag.ts';

const props = defineProps<{
	layer: TimelineLayer;
	tlElWidth: number;
	tlRangeX: number;
	tlPosX: number;
	snapTimes: number[];
	currentTime: number;
}>();

const emit = defineEmits<{
	(ev: 'selected'): void;
}>();

const layerRect = computed(() => {
	const left = timeToDomX(props.layer.startTimeMs);
	const width = timeToDomX(props.layer.endTimeMs) - left;
	return { left, width };
});

type InlineKeyframesTimeline = Extract<ParameterBinding, { inputSource: 'keyframesTimelineInline' }>;
type KeyframeParameter = {
	key: string;
	paramId: string;
	target: 'compositing' | 'module';
	binding: InlineKeyframesTimeline;
};

const keyframeParameters = computed(() => {
	const res: KeyframeParameter[] = [];
	for (const target of ['compositing', 'module'] as const) {
		const values = target === 'compositing' ? props.layer.compositingParamValues : props.layer.paramValues;
		for (const [paramId, binding] of Object.entries(values)) {
			if (binding.inputSource !== 'keyframesTimelineInline') continue;
			res.push({ key: `${target}:${paramId}`, paramId, target, binding });
		}
	}
	return res;
});

function timeScale(binding: InlineKeyframesTimeline): number {
	if (!binding.keyframesTimeline.isNormalized) return 1;
	return binding.durationMs != null && Number.isFinite(binding.durationMs) && binding.durationMs > 0 ? binding.durationMs : 1000;
}

function keyframeTime(binding: InlineKeyframesTimeline, x: number): number {
	const scale = timeScale(binding);
	if (binding.offsetMode === 'end') {
		const lastX = Math.max(...binding.keyframesTimeline.keyframes.map(keyframe => keyframe.x));
		return props.layer.endTimeMs + (x - lastX) * scale;
	}
	return props.layer.startTimeMs + x * scale;
}

const snappingTime = ref<number | null>(null);
let stopKeyframeDrag: (() => void) | undefined;
const SNAP_THRESHOLD = 5;

function onKeyframeMousedown(ev: MouseEvent, param: KeyframeParameter, keyframeId: string) {
	if (ev.button !== 0 || props.tlElWidth <= 0 || props.tlRangeX <= 0) return;
	stopKeyframeDrag?.();
	emit('selected');
	const binding = param.binding;
	const keyframes = binding.keyframesTimeline.keyframes.toSorted((a, b) => a.x - b.x);
	const index = keyframes.findIndex(keyframe => keyframe.id === keyframeId);
	if (index < 0) return;
	const keyframe = keyframes[index];
	// 終端合わせでは最後の時刻がレイヤー終端に固定される。
	if (binding.offsetMode === 'end' && keyframe.x === keyframes[keyframes.length - 1].x) return;
	const minX = Math.max(0, keyframes[index - 1]?.x ?? -Infinity);
	const maxX = Math.min(binding.keyframesTimeline.isNormalized ? 1 : Infinity, keyframes[index + 1]?.x ?? Infinity);
	const scale = timeScale(binding);
	const baseTime = keyframeTime(binding, keyframe.x);
	const originTime = baseTime - keyframe.x * scale;
	const baseClientX = ev.clientX;
	const msPerPixel = props.tlRangeX / props.tlElWidth;
	const mergeKey = genId();
	const layerId = props.layer.id;
	stopKeyframeDrag = dragListen(event => {
		const draggedTime = baseTime + (event.clientX - baseClientX) * msPerPixel;
		let x = Math.max(minX, Math.min(maxX, (draggedTime - originTime) / scale));
		snappingTime.value = null;
		const candidates = [...props.snapTimes, props.layer.startTimeMs, props.layer.endTimeMs, props.currentTime];
		for (const other of keyframeParameters.value) {
			for (const point of other.binding.keyframesTimeline.keyframes) {
				if (other.key === param.key && point.id === keyframeId) continue;
				candidates.push(keyframeTime(other.binding, point.x));
			}
		}
		let nearestDistance = SNAP_THRESHOLD;
		for (const time of candidates) {
			const candidateX = (time - originTime) / scale;
			if (candidateX < minX || candidateX > maxX) continue;
			const distance = Math.abs(time - draggedTime) / msPerPixel;
			if (distance >= nearestDistance) continue;
			nearestDistance = distance;
			x = candidateX;
			snappingTime.value = time;
		}
		// コマンドによる置換後のBindingを毎回取得し、古い参照やpropsを直接変更しない。
		const layer = appContext.state.timeline.value.find(entry => entry.id === layerId);
		if (layer == null) { stopKeyframeDrag?.(); return; }
		const values: Partial<Record<string, ParameterBinding>> = param.target === 'compositing' ? layer.compositingParamValues : layer.paramValues;
		const current = values[param.paramId];
		if (current?.inputSource !== 'keyframesTimelineInline') { stopKeyframeDrag?.(); return; }
		const point = current.keyframesTimeline.keyframes.find(entry => entry.id === keyframeId);
		if (point == null) { stopKeyframeDrag?.(); return; }
		if (point.x === x) return;
		const value = deepClone(current);
		for (const entry of value.keyframesTimeline.keyframes) {
			if (entry.id === keyframeId) entry.x = x;
		}
		appContext.commit('editVisualModuleLayerParam', {
			layerId, target: param.target, paramId: visualModuleCustomParameterId(param.paramId),
			edit: { kind: 'keyframesTimelineInline', value },
		}, mergeKey);
	}, () => {
		stopKeyframeDrag = undefined;
		snappingTime.value = null;
	});
}

function timeToDomX(time: number): number {
	return ((time - props.tlPosX) / props.tlRangeX) * props.tlElWidth;
}

function onLayerBlockClick() {
	emit('selected');
}

onBeforeUnmount(() => stopKeyframeDrag?.());
</script>

<style module lang="scss">
.root {
	--mainRowHeight: 24px;
	--keyframesRowHeight: 20px;

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
	background: #181818;
	direction: ltr;
}

.sideHeader {
	height: var(--mainRowHeight);
	line-height: var(--mainRowHeight);
	display: flex;
	align-items: center;
}

.sideKeyframesRow {
	height: var(--keyframesRowHeight);
	line-height: var(--keyframesRowHeight);
}

.tl {
	position: relative;
	flex: 1;
	direction: ltr;
}

.tlBlock {
	position: relative;
	height: var(--mainRowHeight);
	box-sizing: border-box;
	padding: 0 8px 0 8px;
	//background: linear-gradient(0deg, hsl(from var(--THEME-accent) h s calc(l - 10)), hsl(from var(--THEME-accent) h s calc(l + 10)));
	background: var(--THEME-accent);
	color: var(--THEME-fgOnAccent);
	cursor: pointer;
	border-radius: 8px 0 0 0;
	corner-shape: bevel;
}

.tlKeyframesRow {
	position: relative;
	height: var(--keyframesRowHeight);
	line-height: var(--keyframesRowHeight);
}

.tlKeyframe {
	cursor: ew-resize;
	user-select: none;
	position: absolute;
	--knobSize: 13px; // 奇数にしないとX軸の中心がぴったりにならない
	top: calc(var(--keyframesRowHeight) / 2 - var(--knobSize) / 2);
	width: var(--knobSize);
	height: var(--knobSize);
	margin-left: calc(var(--knobSize) / -2);
	background: var(--THEME-accent);
	corner-shape: bevel;
	border-radius: 100%;
}

.snapLine {
	position: absolute;
	top: 0;
	bottom: 0;
	z-index: 1;
	border-left: 1px solid var(--THEME-accent);
	pointer-events: none;
}
</style>
