<template>
<GsDetachableView :title="i18n.ts._Workspace.AudioSpectrogram" :suspended="renderingSuspended" @changeWindow="changeWindow">
	<div :class="$style.root">
		<canvas v-show="analysisEnabled && !renderingSuspended" ref="canvas" :class="$style.canvas" data-test-audio-spectrogram-canvas></canvas>
		<div v-if="!analysisEnabled" :class="$style.disabledHint" data-test-audio-spectrogram-disabled>{{ i18n.ts.AnalysisDisabled }}</div>
		<div v-if="error" :class="$style.error">{{ error }}</div>
	</div>
</GsDetachableView>
</template>

<script lang="ts" setup>
import { computed, useTemplateRef } from 'vue';
import GsDetachableView from './GsDetachableView.vue';
import type { SpectrogramSettings } from '@gs/subsystems_effect_shared/audio-spectrogram/audio-spectrogram.ts';
import type { PreviewOptions } from '@/audio/audio-preview-types.ts';
import { i18n } from '@/i18n.ts';
import { useAudioPreview } from '@/use-audio-preview.ts';

const props = defineProps<{ options?: Partial<SpectrogramSettings> }>();
const options = computed<PreviewOptions>(() => ({
	mode: 'spectrogram',
	settings: {
		channel: 'mix',
		fftSize: 2048,
		window: 'hann',
		smoothing: 0,
		minFrequency: 20,
		maxFrequency: 20000,
		logarithmic: false,
		minDb: -80,
		maxDb: 0,
		duration: 10,
		orientation: 'horizontal',
		direction: 'forward',
		flipFrequency: false,
		...props.options,
	},
}));
const canvas = useTemplateRef('canvas');
const { changeWindow, error, analysisEnabled, renderingSuspended } = useAudioPreview(canvas, options);
</script>

<style module lang="scss">
.root {
	position: relative;
	flex: 1;
	min-height: 0;
	height: 100%;
	overflow: clip;
	background: #000;
}
.canvas {
	position: absolute;
	inset: 0;
	display: block;
	width: 100%;
	height: 100%;
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
