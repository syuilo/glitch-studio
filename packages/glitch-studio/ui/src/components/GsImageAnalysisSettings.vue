<template>
<div :class="$style.root">
	<span v-if="highResolutionImageAnalysis.errorMessage.value != null">{{ highResolutionImageAnalysis.errorMessage.value }}</span>
	<button class="_button" :class="$style.controlButton" data-test-image-analysis-target @click="showAnalysisTargetMenu">
		{{ analysisTargetLabels[analysisTarget] }} <i class="ti ti-chevron-down"></i>
	</button>
	<button class="_button" :class="$style.controlButton" data-test-image-analysis-scale @click="showAnalysisValueScaleMenu">
		{{ analysisValueScaleLabels[effectiveValueScale] }} <i class="ti ti-chevron-down"></i>
	</button>
	<button class="_button" :class="$style.controlButton" data-test-image-analysis-range @click="showAnalysisRangeMenu">
		{{ analysisRangePreset === 'custom' ? 'Custom' : IMAGE_ANALYSIS_RANGE_PRESETS[analysisRangePreset].label }} <i class="ti ti-chevron-down"></i>
	</button>
	<template v-if="analysisRangePreset === 'custom'">
		<button class="_button" :class="[$style.controlButton, $style.rangeValue]" data-test-image-analysis-min @pointerdown="onRangePointerdown($event, 'minimum')" @click="onRangeClick($event, 'minimum')" @keydown="onRangeKeydown($event, 'minimum')">{{ analysisCustomRange.minimum }}</button>
		<span>~</span>
		<button class="_button" :class="[$style.controlButton, $style.rangeValue]" data-test-image-analysis-max @pointerdown="onRangePointerdown($event, 'maximum')" @click="onRangeClick($event, 'maximum')" @keydown="onRangeKeydown($event, 'maximum')">{{ analysisCustomRange.maximum }}</button>
	</template>
	<div :class="$style.subButtons">
		<button
			v-tooltip="analysisImageSourceTooltip"
			class="_button"
			:class="[$style.subButton, { _buttonPrimaryFg: analyzeAdjustedImage }]"
			:disabled="analysisTarget !== 'rgb'"
			:data-test-image-analysis-adjusted-active="analyzeAdjustedImage"
			data-test-image-analysis-source
			@click="toggleAnalysisImageSource"
		>
			<span class="ti ti-adjustments"></span>
		</button>
		<button
			v-tooltip="'High-Resolution'"
			class="_button"
			:class="[$style.subButton, { _buttonPrimaryFg: highResolutionImageAnalysis.active.value }]"
			data-test-image-analysis-high-res
			:disabled="!highResolutionImageAnalysis.active.value && !projectSession.imageAnalysisAvailable.value"
			@click="projectSession.toggleHighResolutionImageAnalysis()"
		>
			<span v-if="highResolutionImageAnalysis.busy.value">…</span>
			<span v-else class="ti ti-badge-hd"></span>
		</button>
	</div>
</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import { getImageAnalysisValueScales, resolveImageAnalysisValueScale } from '@gs/shared/utility/image-analysis.ts';
import type { ImageValueScale } from '@gs/shared/utility/image-value-scale.ts';
import type { ImageAnalysisTarget } from '@gs/shared/utility/image-analysis.ts';
import { resolvePreviewAnalysisImageSource } from '@gs/glitch-studio_shared/preview-image-analysis.ts';
import type { PreviewImageSource } from '@gs/glitch-studio_shared/preview-image-source.ts';
import type { ImageValueRange } from '@gs/shared/utility/image-value-scale.ts';
import type { ImageAnalysisRangePreset } from '@/utility/image-analysis-range.ts';
import { IMAGE_ANALYSIS_RANGE_PRESETS } from '@/utility/image-analysis-range.ts';
import { startPreviewPointerDrag } from '@/utility/preview-pointer-drag.ts';
import { useProjectSession } from '@/project-session.ts';
import { i18n } from '@/i18n.ts';
import * as ui from '@/ui.ts';

const projectSession = useProjectSession();

const { analysisTarget, analysisImageSource, analysisValueScale, analysisRangePreset, analysisCustomRange, highResolutionImageAnalysis } = projectSession;
const effectiveImageSource = computed(() => resolvePreviewAnalysisImageSource(analysisTarget.value, analysisImageSource.value));
const analysisImageSourceLabels = computed<Record<PreviewImageSource, string>>(() => ({
	original: i18n.ts._Preview.WarningImageSourceOriginal,
	previewAdjusted: i18n.ts._Preview.WarningImageSourceAdjusted,
}));
const analyzeAdjustedImage = computed(() => effectiveImageSource.value === 'previewAdjusted');
const analysisImageSourceTooltip = computed(() => `${i18n.ts._ImageAnalysis.ImageSource}: ${analysisImageSourceLabels.value[effectiveImageSource.value]}`);
const effectiveValueScale = computed(() => resolveImageAnalysisValueScale(analysisTarget.value, analysisValueScale.value));
const analysisTargetLabels = {
	rgb: 'RGB',
	alpha: 'Alpha',
	vectorX: 'Vector X',
	vectorY: 'Vector Y',
	vectorLength: 'Vector Length',
} satisfies Record<ImageAnalysisTarget, string>;
const analysisValueScaleLabels = {
	srgb: 'sRGB',
	linear: 'Linear',
	ev: 'EV · 0 EV = 0.18',
} satisfies Record<ImageValueScale, string>;

let stopRangeDrag: (() => void) | null = null;
let suppressRangeClick: keyof ImageValueRange | null = null;

function setRangeBound(bound: keyof ImageValueRange, value: number) {
	// 表示値と実際の範囲を0.01単位に揃え、負の0も保存しない。
	const rounded = Math.round(value * 100) / 100;
	analysisCustomRange.value = { ...analysisCustomRange.value, [bound]: rounded === 0 ? 0 : rounded };
}

function onRangePointerdown(event: PointerEvent, bound: keyof ImageValueRange) {
	if (event.button !== 0 || stopRangeDrag != null) return;
	const initialValue = analysisCustomRange.value[bound];
	let moved = false;
	suppressRangeClick = null;
	stopRangeDrag = startPreviewPointerDrag(event, {
		move: next => {
			if (Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) >= 3) moved = true;
			if (moved) {
				// 開始位置の近くでは微調整し、離れるほど1pxあたりの変化を大きくする。
				// 常に開始値と累積距離から求め、イベントの頻度や移動経路によって値がずれないようにする。
				const scaledVerticalDistance = (event.clientY - next.clientY) / 100;
				const valueDelta = scaledVerticalDistance * (1 + Math.abs(scaledVerticalDistance));
				setRangeBound(bound, initialValue + valueDelta);
			}
		},
		end: cancelled => {
			if (cancelled) analysisCustomRange.value = { ...analysisCustomRange.value, [bound]: initialValue };
			suppressRangeClick = moved || cancelled ? bound : null;
			stopRangeDrag = null;
			highResolutionImageAnalysis.flush();
		},
	});
}

function onRangeClick(event: MouseEvent, bound: keyof ImageValueRange) {
	// ドラッグ直後のclickだけを抑止し、別のコントロールやキーボードのクリックはリセットする。
	if (suppressRangeClick !== bound || event.detail === 0) setRangeBound(bound, 0);
	suppressRangeClick = null;
}

function onRangeKeydown(event: KeyboardEvent, bound: keyof ImageValueRange) {
	if (stopRangeDrag != null || !['ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
	event.preventDefault();
	setRangeBound(bound, event.key === 'Home' ? 0 : analysisCustomRange.value[bound] + (event.key === 'ArrowUp' ? 0.01 : -0.01));
}

watch(analysisRangePreset, () => stopRangeDrag?.(), { flush: 'sync' });
onBeforeUnmount(() => stopRangeDrag?.());

function toggleAnalysisImageSource() {
	if (analysisTarget.value !== 'rgb') return;
	analysisImageSource.value = analyzeAdjustedImage.value ? 'original' : 'previewAdjusted';
}

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

function showAnalysisRangeMenu(ev: PointerEvent) {
	ui.popupMenu((['zeroToOne', 'minusOneToOne', 'minusOneToFour', 'minusHalfToHalf', 'minusTenToTen', 'custom'] as const).map((preset: ImageAnalysisRangePreset) => ({
		type: 'radioOption' as const,
		text: preset === 'custom' ? 'Custom' : IMAGE_ANALYSIS_RANGE_PRESETS[preset].label,
		active: computed(() => analysisRangePreset.value === preset),
		action: () => { analysisRangePreset.value = preset; },
	})), ev.currentTarget ?? ev.target);
}
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 4px;
	font-size: 90%;
}

.controlButton {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 2px 4px;
	white-space: nowrap;
}

.subButtons {
	display: flex;
	margin-left: auto;
	gap: 4px;
}

.subButton {
	padding: 2px 4px;
}

.rangeValue {
	cursor: ns-resize;
	touch-action: none;
	font-variant-numeric: tabular-nums;
}
</style>
