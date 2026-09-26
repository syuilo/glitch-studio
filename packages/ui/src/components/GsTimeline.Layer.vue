<template>
<div :class="$style.root">
	<div :class="$style.layersSide">
		<div :class="$style.layersSideHeader">{{ layer.id }}</div>
		<div v-for="[k, v] in Object.entries(layer.compositingParamValues).filter(([k, v]) => v.inputSource === 'keyframesTimelineInline')">{{ k }}</div>
	</div>
	<div :class="$style.layersTl">
		<div :class="$style.layerBlock" :style="{ width: layerRect.width + 'px', left: layerRect.left + 'px' }" @click="onLayerBlockClick">{{ layer.id }}</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import GsButton from './common/GsButton.vue';
import type { Timeline, TimelineLayer } from '@glitch/shared/timeline/types.ts';
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

	display: flex;
	flex-direction: row;
	width: 100%;
	overflow: clip;
}

.layersSide {
	position: relative;
	z-index: 1;
	box-sizing: border-box;
	width: var(--sideWidth);
	background: #181818;
	direction: ltr;
}

.layersSideHeader {
	height: var(--mainRowHeight);
	line-height: var(--mainRowHeight);
	display: flex;
	align-items: center;
}

.layersTl {
	position: relative;
	flex: 1;
	direction: ltr;
}

.layerBlock {
	position: absolute;
	height: var(--mainRowHeight);
	box-sizing: border-box;
	padding: 0 8px 0 8px;
	background: linear-gradient(0deg, hsl(from var(--THEME-accent) h s calc(l - 10)), hsl(from var(--THEME-accent) h s calc(l + 10)));
	color: var(--THEME-fgOnAccent);
	cursor: pointer;
	border-radius: 8px 0 0 0;
	corner-shape: bevel;
}
</style>
