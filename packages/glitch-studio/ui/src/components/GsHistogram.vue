<template>
<GsDetachableView :title="i18n.ts._Workspace.Histogram" :suspended="appContext.renderEngine.isSuspended.value">
	<div :class="$style.root">
		<GsImageAnalysisScale/>
		<div :class="$style.scope">
			<div ref="canvasContainer" :class="$style.canvas"></div>
			<div :class="$style.grid">
				<div v-for="position in gridLinePositions" :key="`vertical-${position}`" :class="$style.gridVerticalLine" :style="{ left: `${position}%` }"></div>
			</div>
		</div>
	</div>
</GsDetachableView>
</template>

<script lang="ts" setup>
import { useTemplateRef } from 'vue';
import GsDetachableView from './GsDetachableView.vue';
import GsImageAnalysisScale from './GsImageAnalysisScale.vue';
import { i18n } from '@/i18n.ts';
import { appContext } from '@/app.ts';
import { useRendererCanvas } from '@/use-renderer-canvas.ts';

const { activePreviewRenderer } = appContext;

const canvasContainer = useTemplateRef('canvasContainer');
const gridLinePositions = [12.5, 25, 37.5, 50, 62.5, 75, 87.5];

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

.scope {
	flex: 1;
	min-height: 0;
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

.gridVerticalLine {
	position: absolute;
	background: rgb(76 76 76 / 75%);
}

.gridVerticalLine {
	top: 0;
	bottom: 0;
	width: 1px;
}
</style>
