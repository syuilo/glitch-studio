<template>
<div :class="$style.root">
	<button class="_button" :class="$style.controlButton" data-test-image-analysis-target @click="showAnalysisTargetMenu">
		{{ analysisTargetLabels[analysisTarget] }} <i class="ti ti-chevron-down"></i>
	</button>
	<button class="_button" :class="$style.controlButton" data-test-image-analysis-scale @click="showAnalysisValueScaleMenu">
		{{ analysisValueScaleLabels[effectiveValueScale] }} <i class="ti ti-chevron-down"></i>
	</button>
</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ImageValueScale } from '@gs/shared/utility/image-value-scale.ts';
import { getImageAnalysisValueScales, resolveImageAnalysisValueScale } from '@gs/shared/utility/image-analysis.ts';
import type { ImageAnalysisTarget } from '@gs/shared/utility/image-analysis.ts';
import { appContext } from '@/app.ts';
import * as ui from '@/ui.ts';

const { analysisTarget, analysisValueScale } = appContext;
const effectiveValueScale = computed(() => resolveImageAnalysisValueScale(analysisTarget.value, analysisValueScale.value));
const analysisTargetLabels = {
	rgb: 'RGB',
	alpha: 'Alpha',
	vectorX: 'Vector X',
	vectorY: 'Vector Y',
	vectorLength: 'Vector Length',
} satisfies Record<ImageAnalysisTarget, string>;
const analysisValueScaleLabels = {
	srgb: 'sRGB · 0 ~ +1',
	linearZeroToOne: 'Linear · 0 ~ +1',
	linearMinusOneToOne: 'Linear · −1 ~ +1',
	linear: 'Linear · −1 ~ +4',
	ev: 'EV · −10 ~ +10 · 0 EV = 0.18',
} satisfies Record<ImageValueScale, string>;

function showAnalysisTargetMenu(ev: PointerEvent) {
	ui.popupMenu((['rgb', 'alpha', 'vectorX', 'vectorY', 'vectorLength'] as const).map(target => ({
		type: 'radioOption' as const,
		text: analysisTargetLabels[target],
		active: computed(() => analysisTarget.value === target),
		action: () => { analysisTarget.value = target; },
	})), ev.currentTarget ?? ev.target);
}

function showAnalysisValueScaleMenu(ev: PointerEvent) {
	ui.popupMenu(getImageAnalysisValueScales(analysisTarget.value).map(valueScale => ({
		type: 'radioOption' as const,
		text: analysisValueScaleLabels[valueScale],
		active: computed(() => effectiveValueScale.value === valueScale),
		action: () => { analysisValueScale.value = valueScale; },
	})), ev.currentTarget ?? ev.target);
}
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	font-size: 90%;
}

.controlButton {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 2px 4px;
	background: var(--THEME-panel);
	border: 1px solid var(--THEME-divider);
	border-radius: 4px;
}
</style>
