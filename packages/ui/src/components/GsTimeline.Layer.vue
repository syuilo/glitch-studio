<template>
<div :class="$style.root">
	<div :class="$style.side">
		<div :class="$style.sideHeader">{{ layer.id }}</div>
		<div v-for="param in keyframeParameters" :key="param.key" :class="$style.sideKeyframesRow">{{ param.key }}</div>
	</div>
	<div :class="$style.tl">
		<div v-if="snappingTime != null" :class="$style.snapLine" :style="{ left: timeToDomX(snappingTime) + 'px' }"></div>
		<div :class="$style.tlBlock" :style="{ width: layerRect.width + 'px', left: layerRect.left + 'px' }" @click="onLayerBlockClick">{{ layer.id }}</div>
		<XKeyframesRow
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
			@snap="snappingTime = $event"
		/>
	</div>
</div>
</template>

<script lang="ts">
export type TimelineKeyframeSelection = {
	layerId: string;
	target: 'compositing' | 'module';
	paramId: string;
	keyframeId: string;
};
</script>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { visualModuleCustomParameterId } from '@glitch/shared/visual-module/types.ts';
import XKeyframesRow from './GsTimeline.KeyframesRow.vue';
import type { KeyframeMove } from './GsTimeline.KeyframesRow.vue';
import type { TimelineLayer } from '@glitch/shared/timeline/types.ts';
import type { ParameterBinding } from '@glitch/shared/types.ts';
import { appContext } from '@/app.ts';

const props = defineProps<{
	layer: TimelineLayer;
	tlElWidth: number;
	tlRangeX: number;
	tlPosX: number;
	snapTimes: number[];
	currentTime: number;
	selectedKeyframe: TimelineKeyframeSelection | null;
}>();

const emit = defineEmits<{
	(ev: 'selected'): void;
	(ev: 'keyframeSelected', selection: TimelineKeyframeSelection): void;
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

const snappingTime = ref<number | null>(null);

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
	const layer = appContext.state.timeline.value.find(entry => entry.id === props.layer.id);
	if (layer == null) return;
	const values: Partial<Record<string, ParameterBinding>> = param.target === 'compositing' ? layer.compositingParamValues : layer.paramValues;
	const current = values[param.paramId];
	if (current?.inputSource !== 'keyframesTimelineInline') return;
	const value = deepClone(current);
	const point = value.keyframesTimeline.keyframes.find(entry => entry.id === move.keyframeId);
	if (point == null || point.x === move.x) return;
	point.x = move.x;
	appContext.commit('editVisualModuleLayerParam', {
		layerId: layer.id, target: param.target, paramId: visualModuleCustomParameterId(param.paramId),
		edit: { kind: 'keyframesTimelineInline', value },
	}, move.mergeKey);
}

function timeToDomX(time: number): number {
	return ((time - props.tlPosX) / props.tlRangeX) * props.tlElWidth;
}

function onLayerBlockClick() {
	emit('selected');
}

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

.snapLine {
	position: absolute;
	top: 0;
	bottom: 0;
	z-index: 1;
	border-left: 1px solid var(--THEME-accent);
	pointer-events: none;
}

</style>
