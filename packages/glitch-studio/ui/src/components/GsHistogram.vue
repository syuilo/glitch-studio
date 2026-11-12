<template>
<GsDetachableView :title="i18n.ts._Workspace.Histogram" :suspended="appContext.renderEngine.isSuspended.value" @changeWindow="observeScope">
	<div :class="$style.root">
		<GsImageAnalysisSettings/>
		<div
			ref="scope"
			:class="[$style.scope, { [$style.zoomed]: zoom > 1, [$style.panning]: panning }]"
			data-test-histogram-plot
			tabindex="0"
			@wheel="onWheel"
			@pointerdown="onPointerdown"
			@pointerenter="updatePointerPosition"
			@pointermove="updatePointerPosition"
			@pointerleave="clearPointerPosition"
			@pointercancel="clearPointerPosition"
			@keydown="onKeydown"
			@auxclick.prevent
		>
			<div ref="canvasContainer" :class="$style.canvas"></div>
			<div :class="$style.grid">
				<div
					v-for="tick in gridTicks" :key="tick.value"
					:class="[$style.gridVerticalLine, { [$style.referenceLine]: tick.isReference }]"
					:style="{ left: `${tick.position * 100}%` }"
				></div>
				<div
					v-if="pointerAxisTick != null"
					:class="[$style.gridVerticalLine, $style.pointerGuideLine]"
					:style="{ left: `${pointerAxisTick.position * 100}%` }"
				></div>
			</div>
			<div :class="$style.xAxisTicks" data-test-histogram-x-axis>
				<span
					v-for="tick in xAxisTicks" :key="tick.value"
					:class="[$style.tickLabel, { [$style.startTick]: tick.position === 0, [$style.endTick]: tick.position === 1, [$style.referenceLabel]: tick.isReference }]"
					:style="{ left: `${tick.position * 100}%` }"
				>{{ tick.label }}</span>
				<span
					v-if="pointerAxisTick != null"
					:class="[$style.tickLabel, $style.pointerTickLabel]"
					:style="{ left: `${pointerAxisTick.position * 100}%`, transform: `translateX(-${pointerAxisTick.position * 100}%)` }"
				>{{ pointerAxisTick.label }}</span>
			</div>
		</div>
	</div>
</GsDetachableView>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from 'vue';
import { FULL_PREVIEW_IMAGE_ANALYSIS_VIEWPORT } from '@gs/glitch-studio_shared/preview-image-analysis-viewport.ts';
import { isDrawableImageValueRange } from '@gs/shared/utility/image-value-scale.ts';
import GsDetachableView from './GsDetachableView.vue';
import GsImageAnalysisSettings from './GsImageAnalysisSettings.vue';
import { i18n } from '@/i18n.ts';
import { appContext } from '@/app.ts';
import { useRendererCanvas } from '@/use-renderer-canvas.ts';
import { useImageAnalysisViewport } from '@/use-image-analysis-viewport.ts';
import { useImageAnalysisPointer } from '@/use-image-analysis-pointer.ts';
import { createImageValueAxisTicks, formatImageAnalysisAxisValue, selectImageAnalysisAxisTicks } from '@/utility/image-analysis-axis.ts';

const { imageAnalysisRenderer, displayedImageAnalysisSettings } = appContext;

const canvasContainer = useTemplateRef('canvasContainer');
const scope = useTemplateRef('scope');
const scopeWidth = ref(0);
const { pointerPosition, clearPointerPosition, updatePointerPosition } = useImageAnalysisPointer(scope);
const viewport = computed(() => {
	const range = appContext.analysisHistogramViewport.value;
	return { ...FULL_PREVIEW_IMAGE_ANALYSIS_VIEWPORT, x: range?.minimum ?? 0, width: (range?.maximum ?? 1) - (range?.minimum ?? 0) };
});
const { panning, zoom, cancelPan, onWheel, onPointerdown, onKeydown } = useImageAnalysisViewport(scope, viewport,
	value => appContext.setHistogramViewport({ minimum: value.x, maximum: Math.min(1, value.x + value.width) }),
	() => appContext.flushImageAnalysisDisplay(), appContext.renderEngine.isSuspended, 'x');
const xAxisTicks = computed(() => {
	const settings = displayedImageAnalysisSettings.value;
	if (!isDrawableImageValueRange(settings.valueRange)) return [];
	const span = settings.valueRange.maximum - settings.valueRange.minimum;
	// 未完了の要求を目盛りへ先に反映せず、保持画像も含めて描画済みの切り出し範囲を使う。
	const valueWindow = settings.histogramViewport;
	return selectImageAnalysisAxisTicks(createImageValueAxisTicks(settings.valueScale, {
		minimum: settings.valueRange.minimum + span * (valueWindow?.minimum ?? 0),
		maximum: settings.valueRange.minimum + span * (valueWindow?.maximum ?? 1),
	}, 'float64'), scopeWidth.value, 48);
});
const gridTicks = computed(() => xAxisTicks.value.filter(tick => tick.position > 0 && tick.position < 1));
const pointerAxisTick = computed(() => {
	const position = pointerPosition.value;
	const first = xAxisTicks.value.at(0);
	const last = xAxisTicks.value.at(-1);
	if (position == null || first == null || last == null || appContext.renderEngine.isSuspended.value) return null;
	const value = first.value + (last.value - first.value) * position.x;
	return { position: position.x, label: formatImageAnalysisAxisValue(value, displayedImageAnalysisSettings.value.valueScale) };
});

let scopeResizeObserver: ResizeObserver | null = null;

function observeScope() {
	clearPointerPosition();
	cancelPan();
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

.zoomed {
	cursor: grab;
}

.panning {
	cursor: grabbing;
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
	touch-action: none;
	user-select: none;
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

.pointerTickLabel {
	z-index: 1;
	color: var(--THEME-fgOnAccent);
	background: var(--THEME-accent);
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

.pointerGuideLine {
	background: var(--THEME-accent);
	opacity: 0.65;
}
</style>
