<template>
<div :class="$style.root">
	<div :class="$style.legend">
		<div v-for="item in series" :key="item.key" :class="$style.legendItem">
			<span style="width: 8px; height: 2px;" :style="{ backgroundColor: item.color }"></span>
			<span style="opacity: 0.7;">{{ item.label }}</span>
			<span>{{ formatMs(current[item.key]) }}</span>
		</div>
	</div>
	<div ref="chartEl" :class="$style.chart">
		<svg :viewBox="`0 0 ${chartWidth} ${chartHeight}`" :class="$style.svg">
			<g :class="$style.grid">
				<template v-for="tick in yTicks" :key="tick.value">
					<line :x1="plotLeft" :x2="chartWidth - plotRight" :y1="tick.y" :y2="tick.y"/>
					<text :x="plotLeft - 8" :y="tick.y + 4" text-anchor="end">{{ tick.value.toFixed(0) }}ms</text>
				</template>
				<template v-for="tick in xTicks" :key="tick.label">
					<line :x1="tick.x" :x2="tick.x" :y1="plotTop" :y2="chartHeight - plotBottom"/>
					<text :x="tick.x" :y="chartHeight - 8" :text-anchor="tick.anchor">{{ tick.label }}</text>
				</template>
			</g>
			<polyline
				v-for="item in series"
				:key="item.key"
				:points="polylinePoints(item.key)"
				:stroke="item.color"
				fill="none"
				:stroke-width="item.strokeWidth"
				stroke-linejoin="round"
				vector-effect="non-scaling-stroke"
			/>
		</svg>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import { engine } from '@/app.ts';
import { i18n } from '@/i18n.ts';

type SeriesKey = 'fast' | 'medium' | 'slow';
type RenderTimes = Record<SeriesKey, number>;
type Sample = RenderTimes & { timestamp: number };

const sampleInterval = 100;
const historyDuration = 30_000;
const sampleLimit = historyDuration / sampleInterval;
const chartEl = useTemplateRef('chartEl');
const chartWidth = ref(640);
const chartHeight = ref(320);
const plotLeft = 44;
const plotRight = 12;
const plotTop = 18;
const plotBottom = 28;
const plotWidth = computed(() => chartWidth.value - plotLeft - plotRight);
const plotHeight = computed(() => chartHeight.value - plotTop - plotBottom);

const series = [
	{ key: 'fast', label: 'fast', color: '#c2fe0c', strokeWidth: 1 },
	{ key: 'medium', label: 'medium', color: '#55c8ff', strokeWidth: 1.5 },
	{ key: 'slow', label: 'slow', color: '#c98cff', strokeWidth: 2 },
] as const;

const samples = ref<Sample[]>([]);
const current = ref<RenderTimes>({ fast: 0, medium: 0, slow: 0 });
const maxMs = computed(() => Math.max(4, Math.ceil(Math.max(...samples.value.flatMap(sample => series.map(item => sample[item.key]))) / 4) * 4));
const yTicks = computed(() => Array.from({ length: 5 }, (_, index) => {
	const value = maxMs.value * (4 - index) / 4;
	return { value, y: plotTop + (index / 4) * plotHeight.value };
}));
const xTicks = computed(() => [
	{ x: plotLeft, label: '-30s', anchor: 'start' as const },
	{ x: plotLeft + plotWidth.value / 3, label: '-20s', anchor: 'middle' as const },
	{ x: plotLeft + plotWidth.value * 2 / 3, label: '-10s', anchor: 'middle' as const },
	{ x: chartWidth.value - plotRight, label: '0s', anchor: 'end' as const },
]);

let timer: number | undefined;
let resizeObserver: ResizeObserver | undefined;

function recordSample() {
	const timestamp = performance.now();
	current.value = {
		fast: toMs(engine.gpuAverageDisplayFast.value),
		medium: toMs(engine.gpuAverageDisplayMedium.value),
		slow: toMs(engine.gpuAverageDisplaySlow.value),
	};
	samples.value.push({ ...current.value, timestamp });
	while (samples.value[0]?.timestamp < timestamp - historyDuration || samples.value.length > sampleLimit) samples.value.shift();
}

function polylinePoints(key: SeriesKey) {
	const latestTimestamp = samples.value.at(-1)?.timestamp ?? 0;
	return samples.value.map(sample => {
		const x = plotLeft + (1 - (latestTimestamp - sample.timestamp) / historyDuration) * plotWidth.value;
		const y = plotTop + (1 - sample[key] / maxMs.value) * plotHeight.value;
		return `${x},${y}`;
	}).join(' ');
}

function formatMs(value: number) {
	return `${value.toFixed(1)}ms`;
}

function toMs(value: number) {
	return Number.isFinite(value) && value >= 0 ? value / 1000 : 0;
}

onMounted(() => {
	recordSample();
	timer = window.setInterval(recordSample, sampleInterval);
	resizeObserver = new ResizeObserver(([entry]) => {
		chartWidth.value = entry.contentRect.width;
		chartHeight.value = entry.contentRect.height;
	});
	resizeObserver.observe(chartEl.value!);
});

onBeforeUnmount(() => {
	if (timer != null) window.clearInterval(timer);
	resizeObserver?.disconnect();
});
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	box-sizing: border-box;
	height: 100%;
	min-height: 0;
}

.legend {
	display: flex;
	flex-wrap: wrap;
	gap: 10px 10px;
	padding: 0 0 8px 2px;
	font-size: 80%;
}

.legendItem {
	display: grid;
	grid-template-columns: 8px auto 4em;
	align-items: center;
	gap: 6px;
}

.chart {
	flex: 1;
	position: relative;
	overflow: clip;
	border-radius: 4px;
	background: var(--THEME-bg);
}

.svg {
	position: absolute;
	top: 0;
	left: 0;
	display: block;
	width: 100%;
	height: 100%;
}

.grid {
	line {
		stroke: rgba(255, 255, 255, 0.09);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}

	text {
		fill: rgba(255, 255, 255, 0.45);
		font-family: inherit;
		font-size: 80%;
	}
}
</style>
