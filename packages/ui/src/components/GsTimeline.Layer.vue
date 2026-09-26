<template>
<div :class="$style.root">
	<div :class="$style.side">
		<div :class="$style.sideHeader">{{ layer.id }}</div>
		<div v-for="param in keyframeParameters" :key="param.key" :class="$style.sideKeyframesRow">{{ param.key }}</div>
	</div>
	<div :class="$style.tl">
		<div :class="$style.tlBlock" :style="{ width: layerRect.width + 'px', left: layerRect.left + 'px' }" @click="onLayerBlockClick">{{ layer.id }}</div>
		<div v-for="param in keyframeParameters" :key="param.key" :class="$style.tlKeyframesRow">
			<div
				v-for="keyframe of param.keyframes"
				:key="keyframe.id"
				:class="$style.tlKeyframe"
				:style="{ left: timeToDomX(keyframe.x) + 'px' }"
			>
			</div>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import GsButton from './common/GsButton.vue';
import type { Timeline, TimelineLayer } from '@glitch/shared/timeline/types.ts';
import type { KeyframesTimeline } from '@glitch/shared/types.js';
import { appContext } from '@/app.ts';

const props = defineProps<{
	layer: TimelineLayer;
	tlElWidth: number;
	tlRangeX: number;
	tlPosX: number;
}>();

const emit = defineEmits<{
	(ev: 'selected'): void;
}>();

const layerRect = computed(() => {
	const left = timeToDomX(props.layer.startTimeMs);
	const width = timeToDomX(props.layer.endTimeMs) - left;
	return { left, width };
});

const keyframeParameters = computed(() => {
	const res = [] as {
		key: string;
		isCompositing: boolean;
		keyframes: KeyframesTimeline['keyframes'];
	}[];
	for (const [k, v] of Object.entries(props.layer.compositingParamValues).filter(([k, v]) => v.inputSource === 'keyframesTimelineInline')) {
		res.push({
			key: `compositing:${k}`,
			isCompositing: true,
			keyframes: v.keyframesTimeline.keyframes,
		});
	}
	for (const [k, v] of Object.entries(props.layer.paramValues).filter(([k, v]) => v.inputSource === 'keyframesTimelineInline')) {
		res.push({
			key: `module:${k}`,
			isCompositing: false,
			keyframes: v.keyframesTimeline.keyframes,
		});
	}
	return res;
});

function timeToDomX(time: number): number {
	return ((time - props.tlPosX) / props.tlRangeX) * props.tlElWidth;
}

function onLayerBlockClick(ev: PointerEvent) {
	emit('selected');
}

onMounted(() => {

});
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
	background: linear-gradient(0deg, hsl(from var(--THEME-accent) h s calc(l - 10)), hsl(from var(--THEME-accent) h s calc(l + 10)));
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
</style>
