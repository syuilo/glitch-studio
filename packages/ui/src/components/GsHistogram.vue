<template>
<GsDetachableView title="Histogram">
<div :class="$style.root">
	<div ref="canvasContainer" :class="$style.canvas"></div>
</div>
</GsDetachableView>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue';
import GsDetachableView from './GsDetachableView.vue';
import { previewRendererController } from '@/app.ts';

const canvasContainer = useTemplateRef('canvasContainer');

onMounted(() => {
	if (canvasContainer.value != null) {
		canvasContainer.value.appendChild(previewRendererController.histogramCanvas);
	}
});

onBeforeUnmount(() => {
	if (canvasContainer.value != null) {
		canvasContainer.value.removeChild(previewRendererController.histogramCanvas);
	}
});
</script>

<style lang="scss" module>
.root {
	position: relative;
	width: 100%;
	height: 100%;
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
