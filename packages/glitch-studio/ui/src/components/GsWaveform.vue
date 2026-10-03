<template>
<GsDetachableView :title="direction === 'horizontal' ? 'Waveform (X)' : 'Waveform (Y)'">
	<div :class="$style.root">
		<div :class="$style.scope">
			<div ref="canvasContainer" :class="$style.canvas"></div>
		</div>
	</div>
</GsDetachableView>
</template>

<script lang="ts" setup>
import { useTemplateRef } from 'vue';
import { useRendererCanvas } from '@/use-renderer-canvas.ts';
import GsDetachableView from './GsDetachableView.vue';
import { activePreviewRenderer } from '@/app.ts';

const props = defineProps<{
	direction: 'horizontal' | 'vertical';
}>();

const canvasContainer = useTemplateRef('canvasContainer');

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
</style>
