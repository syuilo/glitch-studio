<template>
<GsDetachableView :title="i18n.ts._Workspace.Histogram" :suspended="appContext.renderEngine.isSuspended.value" @changeWindow="observeScope">
	<div :class="$style.root">
		<GsImageAnalysisSettings/>
		<div ref="scope" :class="$style.scope" data-test-histogram-plot>
			<div ref="canvasContainer" :class="$style.canvas"></div>
			<div :class="$style.grid">
				<div
					v-for="tick in gridTicks" :key="tick.value"
					:class="[$style.gridVerticalLine, { [$style.referenceLine]: tick.isReference }]"
					:style="{ left: `${tick.position * 100}%` }"
				></div>
			</div>
			<div :class="$style.xAxisTicks" data-test-histogram-x-axis>
				<span
					v-for="tick in xAxisTicks" :key="tick.value"
					:class="[$style.tickLabel, { [$style.startTick]: tick.position === 0, [$style.endTick]: tick.position === 1, [$style.referenceLabel]: tick.isReference }]"
					:style="{ left: `${tick.position * 100}%` }"
				>{{ tick.label }}</span>
			</div>
		</div>
	</div>
</GsDetachableView>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from 'vue';
import GsDetachableView from './GsDetachableView.vue';
import GsImageAnalysisSettings from './GsImageAnalysisSettings.vue';
import { i18n } from '@/i18n.ts';
import { appContext } from '@/app.ts';
import { useRendererCanvas } from '@/use-renderer-canvas.ts';
import { createImageValueAxisTicks, selectImageAnalysisAxisTicks } from '@/utility/image-analysis-axis.ts';

const { imageAnalysisRenderer, displayedImageAnalysisSettings } = appContext;

const canvasContainer = useTemplateRef('canvasContainer');
const scope = useTemplateRef('scope');
const scopeWidth = ref(0);
const xAxisTicks = computed(() => selectImageAnalysisAxisTicks(createImageValueAxisTicks(displayedImageAnalysisSettings.value.valueScale, displayedImageAnalysisSettings.value.valueRange), scopeWidth.value, 48));
const gridTicks = computed(() => xAxisTicks.value.filter(tick => tick.position > 0 && tick.position < 1));

let scopeResizeObserver: ResizeObserver | null = null;

function observeScope() {
	scopeResizeObserver?.disconnect();
	const element = scope.value;
	if (element == null) return;
	// 別ウィンドウへ移した後も、その表示先のレイアウト更新で目盛りを再計算する。
	const scopeWindow = element.ownerDocument.defaultView ?? window;
	scopeResizeObserver = new scopeWindow.ResizeObserver(([entry]) => {
		scopeWidth.value = entry.contentRect.width;
	});
	scopeResizeObserver.observe(element);
}

onMounted(observeScope);
// GsDetachableViewの破棄時にもchangeWindowが発生するため、子の片付け後に監視を解除する。
onUnmounted(() => scopeResizeObserver?.disconnect());

useRendererCanvas(canvasContainer, imageAnalysisRenderer, () => 'histogramCanvas', appContext.renderEngine.isSuspended);
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	position: relative;
	width: 100%;
	height: 100%;
	min-width: 0;
	min-height: 0;
	overflow: clip;
}

.scope {
	flex: 1;
	min-width: 0;
	min-height: 0;
	position: relative;
	width: 100%;
	box-sizing: border-box;
	border: 1px solid #fff2;
	overflow: clip;
}

.xAxisTicks {
	position: absolute;
	right: 0;
	bottom: 0;
	left: 0;
	height: 14px;
	pointer-events: none;

	> .tickLabel {
		top: 0;
		transform: translateX(-50%);

		&.startTick {
			transform: translateX(0px);
		}

		&.endTick {
			transform: translateX(-100%);
		}
	}
}

.tickLabel {
	position: absolute;
	padding: 0 2px;
	font-size: 10px;
	line-height: 14px;
	white-space: nowrap;
	font-variant-numeric: tabular-nums;
	color: color-mix(in srgb, var(--THEME-fg) 80%, transparent);
	// 明るいヒストグラムの上でも数値を読めるよう、文字の背後だけを暗くする。
	background: rgb(0 0 0 / 60%);
}

.referenceLabel {
	color: var(--THEME-fg);
}

.canvas {
	position: absolute;
	top: 0;
	left: 0;
	display: block;
	width: 100%;
	height: 100%;
}

.grid {
	position: absolute;
	inset: 0;
	box-sizing: border-box;
	pointer-events: none;
}

.gridVerticalLine {
	position: absolute;
	background: rgb(76 76 76 / 75%);
	top: 0;
	bottom: 0;
	width: 1px;
}

.referenceLine {
	background: rgb(160 160 160 / 65%);
}
</style>
