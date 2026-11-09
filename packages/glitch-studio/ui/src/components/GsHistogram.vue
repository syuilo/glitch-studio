<template>
<GsDetachableView :title="i18n.ts._Workspace.Histogram" :suspended="appContext.renderEngine.isSuspended.value">
<div :class="$style.root">
	<GsImageAnalysisScale/>
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
import GsImageAnalysisScale from './GsImageAnalysisScale.vue';

const { activePreviewRenderer } = appContext;

const canvasContainer = useTemplateRef('canvasContainer');

useRendererCanvas(canvasContainer, activePreviewRenderer, () => 'histogramCanvas', appContext.renderEngine.isSuspended);
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	position: relative;
	width: 100%;
	height: 100%;
}

.canvas {
	flex: 1;
	min-height: 0;
	display: block;
	width: 100%;
	height: 100%;
}
</style>
