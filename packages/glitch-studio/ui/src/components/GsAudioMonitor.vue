<template>
<GsDetachableView :title="mode === 'spectrum' ? 'Audio Spectrum' : 'Audio Waveform'" @changeWindow="changeWindow">
	<template #controls>
		<label :class="$style.option"><input v-model="overlay" type="checkbox"> Overlay L/R</label>
	</template>
	<div :class="$style.root" @wheel="onWheel">
		<div :class="$style.plot">
			<div :class="$style.grid">
				<div v-for="lane in (overlay ? 1 : 2)" :key="lane" :class="$style.lane"></div>
			</div>
			<canvas ref="canvas" :class="$style.canvas"></canvas>
			<span :class="$style.left">L</span>
			<span :class="$style.right" :style="{ top: overlay ? '0' : '50%', left: overlay ? '18px' : '0' }">R</span>
		</div>
		<div :class="$style.axis">
			<template v-if="mode === 'spectrum'">
				<span v-for="(tick, index) in frequencyTicks" :key="tick.value" :style="{
					left: `${tick.position * 100}%`,
					transform: index === 0 ? 'none' : index === frequencyTicks.length - 1 && tick.position === 1 ? 'translateX(-100%)' : 'translateX(-50%)',
				}">{{ tick.value >= 1000 ? `${tick.value / 1000}k` : tick.value }}</span>
			</template>
			<template v-else><span style="left: 0">−{{ (displaySeconds * 1000).toFixed(1) }} ms</span><span style="right: 0">0</span></template>
		</div>
		<div v-if="error" :class="$style.error">{{ error }}</div>
	</div>
</GsDetachableView>
</template>

<script lang="ts" setup>
import { computed, ref, useTemplateRef } from 'vue';
import GsDetachableView from './GsDetachableView.vue';
import { useAudioPreview } from '@/use-audio-preview.ts';
import type { PreviewOptions } from '@/audio/audio-preview-types.ts';

const props = defineProps<{ mode: 'spectrum' | 'waveform' }>();
const overlay = defineModel<boolean>('overlay', { default: false });
const canvas = useTemplateRef('canvas');
const waveformSeconds = ref(0.04);
const options = computed<PreviewOptions>(() => ({ mode: props.mode,
	settings: { overlay: overlay.value, waveformSeconds: waveformSeconds.value } }));
const { changeWindow, error, sampleRate } = useAudioPreview(canvas, options);
const displaySeconds = computed(() => Math.max(2, Math.min(32768, Math.round(sampleRate.value * waveformSeconds.value))) / sampleRate.value);
const frequencyTicks = computed(() => {
	const max = Math.min(20000, sampleRate.value / 2);
	return [20, 100, 1000, 10000, 20000].filter(value => value <= max)
		.map(value => ({ value, position: Math.log(value / 20) / Math.log(max / 20) }));
});

function onWheel(event: WheelEvent) {
	if (props.mode !== 'waveform' || event.deltaY === 0) return;
	event.preventDefault();
	event.stopPropagation();
	const height = canvas.value?.getBoundingClientRect().height ?? 0;
	const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
	waveformSeconds.value = Math.max(2 / sampleRate.value, Math.min(32768 / sampleRate.value,
		displaySeconds.value * Math.exp(Math.max(-1, Math.min(1, delta * 0.002)))));
}
</script>

<style module lang="scss">
.root { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; background: #111; }
.plot { position: absolute; top: 30px; bottom: 18px; left: 8px; right: 8px; overflow: clip; }
.canvas, .grid { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.grid { display: flex; flex-direction: column; }
.lane { flex: 1; background: repeating-linear-gradient(to bottom, #ffffff18 0 1px, transparent 1px 25%); border-bottom: 1px solid #ffffff18; }
.left, .right { position: absolute; top: 0; left: 0; font: 10px sans-serif; pointer-events: none; }
.left { color: #ff8400; }
.right { color: #c2fe0c; }
.axis { position: absolute; bottom: 4px; left: 8px; right: 8px; height: 12px; color: #a1adaf; font: 10px sans-serif; pointer-events: none; }
.axis > span { position: absolute; white-space: nowrap; }
.error { position: absolute; inset: 30px 8px 18px; background: #111e; color: #ff8400; overflow: auto; }
.option { display: flex; align-items: center; gap: 4px; font-size: 11px; }
</style>
