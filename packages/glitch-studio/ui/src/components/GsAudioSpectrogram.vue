<template>
<GsDetachableView :title="i18n.ts._Workspace.AudioSpectrogram" :suspended="renderingSuspended" @changeWindow="changeWindow">
	<template #default="{ detached }">
		<div :class="$style.root">
			<div v-show="analysisEnabled" :class="$style.controls">
				<select
					v-if="detached"
					:class="$style.controlButton"
					:value="settings.logarithmic ? 'logarithmic' : 'linear'"
					:disabled="interactionDisabled"
					data-test-audio-spectrogram-detached-scale
					@change="onDetachedScaleChange"
				>
					<option value="linear">Linear</option>
					<option value="logarithmic">Logarithmic</option>
				</select>
				<button
					v-else
					class="_button"
					:class="$style.controlButton"
					:disabled="interactionDisabled"
					data-test-audio-spectrogram-scale
					@click="showScaleMenu"
				>
					{{ settings.logarithmic ? 'Logarithmic' : 'Linear' }} <i class="ti ti-chevron-down"></i>
				</button>
				<button
					v-tooltip="i18n.ts._AudioMonitor.SpectrogramHold"
					class="_button"
					:class="[$style.controlButton, $style.holdButton, { _buttonPrimaryFg: hold }]"
					:disabled="interactionDisabled"
					:data-test-audio-spectrogram-held="hold"
					data-test-audio-spectrogram-hold
					@click="toggleHold"
				>HOLD</button>
			</div>
			<div
				v-show="analysisEnabled"
				ref="plot"
				:class="[$style.plot, { [$style.panning]: panning }]"
				data-test-audio-spectrogram-plot
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
				<canvas
					v-show="analysisEnabled && !renderingSuspended"
					ref="canvas"
					:class="$style.canvas"
					data-test-audio-spectrogram-canvas
				></canvas>
				<div :class="$style.grid">
					<div
						v-for="tick in horizontalGridTicks" :key="tick.position"
						:class="[$style.gridHorizontalLine, { [$style.referenceLine]: tick.isReference }]"
						:style="{ top: `${tick.position * 100}%` }"
					></div>
					<div
						v-for="tick in verticalGridTicks" :key="tick.position"
						:class="[$style.gridVerticalLine, { [$style.referenceLine]: tick.isReference }]"
						:style="{ left: `${tick.position * 100}%` }"
					></div>
					<div
						v-if="pointerAxisTicks != null"
						:class="[$style.gridHorizontalLine, $style.pointerGuideLine]"
						:style="{ top: `${pointerAxisTicks.y.position * 100}%` }"
					></div>
					<div
						v-if="pointerAxisTicks != null"
						:class="[$style.gridVerticalLine, $style.pointerGuideLine]"
						:style="{ left: `${pointerAxisTicks.x.position * 100}%` }"
					></div>
				</div>
				<div
					v-if="selection != null"
					:class="$style.selection"
					data-test-audio-spectrogram-selection
					:style="{ left: `${selection.x * 100}%`, top: `${selection.y * 100}%`, width: `${selection.width * 100}%`, height: `${selection.height * 100}%` }"
				></div>
				<div :class="$style.yAxisTicks" data-test-audio-spectrogram-y-axis>
					<span
						v-for="tick in axisTicks.y" :key="tick.position"
						:class="[$style.tickLabel, { [$style.startTick]: tick.position === 0, [$style.endTick]: tick.position === 1, [$style.referenceLabel]: tick.isReference }]"
						:style="{ top: `${tick.position * 100}%` }"
					>{{ tick.label }}</span>
					<span
						v-if="pointerAxisTicks != null"
						:class="[$style.tickLabel, $style.pointerTickLabel]"
						:style="{ top: `clamp(0px, calc(${pointerAxisTicks.y.position * 100}% - 7px), calc(100% - 28px))`, transform: 'none' }"
					>{{ pointerAxisTicks.y.label }}</span>
				</div>
				<div :class="$style.xAxisTicks" data-test-audio-spectrogram-x-axis>
					<span
						v-for="tick in axisTicks.x" :key="tick.position"
						:class="[$style.tickLabel, { [$style.startTick]: tick.position === 0, [$style.endTick]: tick.position === 1, [$style.referenceLabel]: tick.isReference }]"
						:style="{ left: `${tick.position * 100}%` }"
					>{{ tick.label }}</span>
					<span
						v-if="pointerAxisTicks != null"
						:class="[$style.tickLabel, $style.pointerTickLabel]"
						:style="{ left: `${pointerAxisTicks.x.position * 100}%`, transform: `translateX(-${pointerAxisTicks.x.position * 100}%)` }"
					>{{ pointerAxisTicks.x.label }}</span>
				</div>
			</div>
			<div v-if="!analysisEnabled" :class="$style.disabledHint" data-test-audio-spectrogram-disabled>{{ i18n.ts.AnalysisDisabled }}</div>
			<div v-if="error !== ''" :class="$style.error">{{ error }}</div>
		</div>
	</template>
</GsDetachableView>
</template>

<script lang="ts" setup>
import { computed, ref, shallowRef, useTemplateRef } from 'vue';
import { FULL_PREVIEW_IMAGE_ANALYSIS_VIEWPORT } from '@gs/glitch-studio_shared/preview-image-analysis-viewport.ts';
import GsDetachableView from './GsDetachableView.vue';
import type { PreviewSpectrogramOptions, PreviewSpectrogramSettings } from '@/audio/audio-preview-types.ts';
import { resolvePreviewSpectrogramSettings } from '@/audio/audio-preview-spectrogram-settings.ts';
import { createSpectrogramAxes, followLatestSpectrogramTime, reprojectSpectrogramFrequencyViewport } from '@/audio/audio-spectrogram-axis.ts';
import { i18n } from '@/i18n.ts';
import * as ui from '@/ui.ts';
import { useAudioPreview } from '@/use-audio-preview.ts';
import { useImageAnalysisPointer } from '@/use-image-analysis-pointer.ts';
import { useImageAnalysisViewport } from '@/use-image-analysis-viewport.ts';
import { selectImageAnalysisAxisTicks } from '@/utility/image-analysis-axis.ts';

const props = defineProps<{ options?: Partial<PreviewSpectrogramSettings> }>();
const liveSettings = computed<PreviewSpectrogramSettings>(() => ({
	channel: 'mix',
	fftSize: 2048,
	window: 'hann',
	smoothing: 0,
	minFrequency: 20,
	maxFrequency: null,
	logarithmic: true,
	minDb: -80,
	maxDb: 0,
	duration: 10,
	orientation: 'horizontal',
	direction: 'forward',
	flipFrequency: false,
	...props.options,
}));
const heldSettings = shallowRef<PreviewSpectrogramSettings | null>(null);
const hold = computed(() => heldSettings.value != null);
const scaleOverride = ref<boolean | null>(null);
const settings = computed(() => {
	const current = heldSettings.value ?? liveSettings.value;
	return { ...current, logarithmic: scaleOverride.value ?? current.logarithmic };
});
const viewport = shallowRef({ ...FULL_PREVIEW_IMAGE_ANALYSIS_VIEWPORT });
const options = computed<PreviewSpectrogramOptions>(() => ({
	mode: 'spectrogram',
	settings: settings.value,
	viewport: viewport.value,
	hold: hold.value,
}));
const canvas = useTemplateRef('canvas');
const plot = useTemplateRef('plot');
const { changeWindow: changeAudioPreviewWindow, error, size, spectrogramSampleRate, analysisEnabled, renderingSuspended } = useAudioPreview(canvas, options);
const interactionDisabled = computed(() => !analysisEnabled.value || renderingSuspended.value || error.value !== '');
const { pointerPosition, clearPointerPosition, updatePointerPosition } = useImageAnalysisPointer(plot);
const { panning, selection, cancelInteraction, onWheel, onPointerdown, onKeydown } = useImageAnalysisViewport(plot, viewport,
	value => { viewport.value = value; }, () => {}, interactionDisabled);

const resolvedSettings = computed(() => resolvePreviewSpectrogramSettings(settings.value, spectrogramSampleRate.value));
const axes = computed(() => createSpectrogramAxes(resolvedSettings.value, viewport.value));
const axisTicks = computed(() => ({
	x: selectImageAnalysisAxisTicks(axes.value.x.ticks, size.value.width, 48),
	y: selectImageAnalysisAxisTicks(axes.value.y.ticks, size.value.height, 40),
}));
const horizontalGridTicks = computed(() => axisTicks.value.y.filter(tick => tick.position > 0 && tick.position < 1));
const verticalGridTicks = computed(() => axisTicks.value.x.filter(tick => tick.position > 0 && tick.position < 1));
const pointerAxisTicks = computed(() => {
	const position = pointerPosition.value;
	if (position == null || interactionDisabled.value) return null;
	return {
		x: { position: position.x, label: axes.value.x.labelAt(position.x) },
		y: { position: position.y, label: axes.value.y.labelAt(position.y) },
	};
});

function changeWindow() {
	clearPointerPosition();
	cancelInteraction();
	changeAudioPreviewWindow();
}

function toggleHold() {
	cancelInteraction();
	if (heldSettings.value == null) {
		heldSettings.value = liveSettings.value;
	} else {
		heldSettings.value = null;
		viewport.value = followLatestSpectrogramTime(viewport.value, resolvedSettings.value);
	}
}

function setLogarithmic(logarithmic: boolean) {
	if (interactionDisabled.value || logarithmic === settings.value.logarithmic) return;
	cancelInteraction();
	const previousSettings = resolvedSettings.value;
	scaleOverride.value = logarithmic;
	viewport.value = reprojectSpectrogramFrequencyViewport(viewport.value, previousSettings, resolvedSettings.value);
}

function showScaleMenu(event: MouseEvent) {
	ui.popupMenu([false, true].map(logarithmic => ({
		type: 'radioOption' as const,
		text: logarithmic ? 'Logarithmic' : 'Linear',
		active: computed(() => settings.value.logarithmic === logarithmic),
		action: () => setLogarithmic(logarithmic),
	})), event.currentTarget ?? event.target);
}

function onDetachedScaleChange(event: Event) {
	// 通常のポップアップは親Documentに描画されるため、別ウィンドウではその場で開く選択欄を使う。
	setLogarithmic((event.currentTarget as HTMLSelectElement).value === 'logarithmic');
}
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	position: relative;
	box-sizing: border-box;
	height: 100%;
	min-width: 0;
	min-height: 0;
	overflow: clip;
}

.controls {
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

.holdButton {
	margin-left: auto;
}

.plot {
	flex: 1;
	position: relative;
	min-width: 0;
	min-height: 0;
	box-sizing: border-box;
	border: 1px solid #fff2;
	overflow: clip;
	touch-action: none;
	user-select: none;
	cursor: crosshair;
	background: #000;
}

.panning {
	cursor: grabbing;
}

.selection {
	position: absolute;
	box-sizing: border-box;
	border: 1px solid var(--THEME-accent);
	background: color(from var(--THEME-accent) srgb r g b / 0.15);
	pointer-events: none;
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

.pointerGuideLine {
	background: var(--THEME-accent);
	opacity: 0.65;
}
.error {
	position: absolute;
	inset: 0;
	background: #111e;
	color: #ff8400;
	overflow: auto;
}
.disabledHint {
	display: grid;
	place-content: center;
	box-sizing: border-box;
	height: 100%;
	padding: 16px;
	text-align: center;
}
</style>
