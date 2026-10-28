<template>
<GsDetachableView :title="i18n.ts._Workspace.Histogram" :suspended="appContext.renderEngine.isSuspended.value">
<div :class="$style.root">
	<div ref="canvasContainer" :class="$style.canvas"></div>
</div>
</GsDetachableView>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.ts';
import { appContext } from '@/app.ts';
import { useTemplateRef } from 'vue';
import { useRendererCanvas } from '@/use-renderer-canvas.ts';
import GsDetachableView from './GsDetachableView.vue';

const { activePreviewRenderer } = appContext;

const canvasContainer = useTemplateRef('canvasContainer');

useRendererCanvas(canvasContainer, activePreviewRenderer, () => 'histogramCanvas', appContext.renderEngine.isSuspended);
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
