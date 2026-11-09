<template>
<div :class="$style.root">
	<button class="_button" :class="$style.scaleButton" data-test-image-analysis-scale @click="showAnalysisValueScaleMenu">
		{{ analysisValueScaleLabels[analysisValueScale] }} <i class="ti ti-chevron-down"></i>
	</button>
</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ImageValueScale } from '@gs/shared/utility/image-value-scale.ts';
import { appContext } from '@/app.ts';
import * as ui from '@/ui.ts';

const { analysisValueScale } = appContext;
const analysisValueScaleLabels = {
	srgb: 'sRGB · 0 ~ +1',
	linearZeroToOne: 'Linear · 0 ~ +1',
	linearMinusOneToOne: 'Linear · −1 ~ +1',
	linear: 'Linear · −1 ~ +4',
	ev: 'EV · −10 ~ +10 · 0 EV = 0.18',
} satisfies Record<ImageValueScale, string>;

function showAnalysisValueScaleMenu(ev: PointerEvent) {
	ui.popupMenu((['srgb', 'linearZeroToOne', 'linearMinusOneToOne', 'linear', 'ev'] as const).map(valueScale => ({
		type: 'radioOption' as const,
		text: analysisValueScaleLabels[valueScale],
		active: computed(() => analysisValueScale.value === valueScale),
		action: () => { analysisValueScale.value = valueScale; },
	})), ev.currentTarget ?? ev.target);
}
</script>

<style module lang="scss">
.root {
	display: block;
	font-size: 90%;
}

.scaleButton {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 2px 4px;
	background: var(--THEME-panel);
	border: 1px solid var(--THEME-divider);
	border-radius: 4px;
}
</style>
