<template>
<GsDetachableView :title="direction === 'horizontal' ? i18n.ts._Workspace.WaveformX : i18n.ts._Workspace.WaveformY" :suspended="appContext.renderEngine.isSuspended.value" @changeWindow="observeScope">
	<div :class="$style.root">
		<GsImageAnalysisSettings/>
		<div ref="scope" :class="$style.scope" data-test-waveform-plot>
			<div ref="canvasContainer" :class="$style.canvas"></div>
			<div :class="$style.grid">
				<div
					v-for="tick in horizontalGridTicks" :key="tick.value"
					:class="[$style.gridHorizontalLine, { [$style.referenceLine]: tick.isReference }]"
					:style="{ top: `${tick.position * 100}%` }"
				></div>
				<div
					v-for="tick in verticalGridTicks" :key="tick.value"
					:class="[$style.gridVerticalLine, { [$style.referenceLine]: tick.isReference }]"
					:style="{ left: `${tick.position * 100}%` }"
				></div>
			</div>
			<div :class="$style.yAxisTicks" data-test-waveform-y-axis>
				<span
					v-for="tick in axisTicks.y" :key="tick.value"
					:class="[$style.tickLabel, { [$style.startTick]: tick.position === 0, [$style.endTick]: tick.position === 1, [$style.referenceLabel]: tick.isReference }]"
					:style="{ top: `${tick.position * 100}%` }"
				>{{ tick.label }}</span>
			</div>
			<div :class="$style.xAxisTicks" data-test-waveform-x-axis>
				<span
					v-for="tick in axisTicks.x" :key="tick.value"
					:class="[$style.tickLabel, { [$style.startTick]: tick.position === 0, [$style.endTick]: tick.position === 1, [$style.referenceLabel]: tick.isReference }]"
					:style="{ left: `${tick.position * 100}%` }"
				>{{ tick.label }}</span>
			</div>
		</div>
	</div>
</GsDetachableView>
</template>

<script lang="ts" setup>
import { computed, useTemplateRef } from 'vue';
import GsDetachableView from './GsDetachableView.vue';
import GsImageAnalysisSettings from './GsImageAnalysisSettings.vue';
import { i18n } from '@/i18n.ts';
import { appContext } from '@/app.ts';
import { useRendererCanvas } from '@/use-renderer-canvas.ts';
import { useWaveformCanvasSize } from '@/use-waveform-canvas-size.ts';
import { createImagePositionAxisTicks, createImageValueAxisTicks, selectImageAnalysisAxisTicks } from '@/utility/image-analysis-axis.ts';

const { imageAnalysisRenderer, displayedImageAnalysisSettings } = appContext;

const props = defineProps<{
	direction: 'horizontal' | 'vertical';
}>();

const canvasContainer = useTemplateRef('canvasContainer');
const scope = useTemplateRef('scope');
const { size: scopeSize, changeWindow: observeScope } = useWaveformCanvasSize(scope, size => appContext.setWaveformCanvasSize(props.direction, size));
const axisTicks = computed(() => {
	const horizontal = props.direction === 'horizontal';
	const positionTicks = createImagePositionAxisTicks();
	const valueTicks = createImageValueAxisTicks(displayedImageAnalysisSettings.value.valueScale, displayedImageAnalysisSettings.value.valueRange);
	return {
		x: selectImageAnalysisAxisTicks(horizontal ? positionTicks : valueTicks, scopeSize.value.width, 48),
		// Waveform Xの値は下から上へ増える。Waveform Yの画像位置は上端が0%。
		// 左下のY軸ラベルはX軸のラベルより上へ寄せるため、その移動分も含めて間隔を空ける。
		y: selectImageAnalysisAxisTicks(horizontal ? valueTicks.map(tick => ({ ...tick, position: 1 - tick.position })) : positionTicks, scopeSize.value.height, 40),
	};
});
const horizontalGridTicks = computed(() => axisTicks.value.y.filter(tick => tick.position > 0 && tick.position < 1));
const verticalGridTicks = computed(() => axisTicks.value.x.filter(tick => tick.position > 0 && tick.position < 1));

useRendererCanvas(canvasContainer, imageAnalysisRenderer, () => props.direction === 'horizontal' ? 'waveformHorizontalCanvas' : 'waveformVerticalCanvas', appContext.renderEngine.isSuspended);
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	box-sizing: border-box;
	height: 100%;
	min-width: 0;
	min-height: 0;
	overflow: clip;
}

.scope {
	flex: 1;
	position: relative;
	min-width: 0;
	min-height: 0;
	box-sizing: border-box;
	border: 1px solid #fff2;
	overflow: clip;
}

.yAxisTicks {
	position: absolute;
	top: 0;
	bottom: 0;
	left: 0;
	pointer-events: none;

	> .tickLabel {
		left: 0;
		transform: translateY(-50%);

		&.startTick {
			transform: translateY(0px);
		}

		&.endTick {
			// 下端の値はX軸のラベルの直上に置き、左下で二つのラベルが重ならないようにする。
			transform: translateY(calc(-100% - 14px));
		}
	}
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
	// 明るい波形の上でも数値を読めるよう、文字の背後だけを暗くする。
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

.referenceLine {
	background: rgb(160 160 160 / 65%);
}
</style>
