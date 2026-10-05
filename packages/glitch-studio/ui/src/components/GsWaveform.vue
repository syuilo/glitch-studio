<template>
<GsDetachableView :title="direction === 'horizontal' ? 'Waveform (X)' : 'Waveform (Y)'">
	<div :class="$style.root">
		<div :class="$style.scope">
			<div ref="canvasContainer" :class="$style.canvas"></div>
			<div :class="$style.grid" aria-hidden="true">
				<div v-for="position in gridLinePositions" :key="`horizontal-${position}`" :class="$style.gridHorizontalLine" :style="{ top: `${position}%` }"></div>
				<div v-for="position in gridLinePositions" :key="`vertical-${position}`" :class="$style.gridVerticalLine" :style="{ left: `${position}%` }"></div>
			</div>
		</div>
	</div>
</GsDetachableView>
</template>

<script lang="ts" setup>
import { appContext } from '@/app.ts';
import { useTemplateRef } from 'vue';
import { useRendererCanvas } from '@/use-renderer-canvas.ts';
import GsDetachableView from './GsDetachableView.vue';

const { activePreviewRenderer } = appContext;

const props = defineProps<{
	direction: 'horizontal' | 'vertical';
}>();

const canvasContainer = useTemplateRef('canvasContainer');
const gridLinePositions = [25, 50, 75];

useRendererCanvas(canvasContainer, activePreviewRenderer, () => props.direction === 'horizontal' ? 'waveformHorizontalCanvas' : 'waveformVerticalCanvas');
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	box-sizing: border-box;
	height: 100%;
	min-height: 0;
	box-sizing: border-box;
}

.header {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	padding: 2px 4px 10px;
}

.scope {
	flex: 1;
	position: relative;
	width: 100%;
	overflow: clip;
}

.canvas {
	position: absolute;
	top: 0;
	left: 0;
	display: block;
	width: 100%;
	height: 100%;
}

// 表示用の目盛りはCanvasの上に重ね、レンダラーの出力には含めない。
.grid {
	position: absolute;
	inset: 0;
	box-sizing: border-box;
	border: 1px solid rgb(76 76 76 / 75%);
	pointer-events: none;
}

.gridHorizontalLine,
.gridVerticalLine {
	position: absolute;
	background: rgb(76 76 76 / 75%);
}

.gridHorizontalLine {
	left: 0;
	right: 0;
	height: 1px;
}

.gridVerticalLine {
	top: 0;
	bottom: 0;
	width: 1px;
}
</style>
