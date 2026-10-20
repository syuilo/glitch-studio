<template>
<div :class="$style.root">
	<div :class="$style.legend">
		<div v-for="item in series" :key="item.key" :title="item.description" :data-test-rendering-stat="item.key" :class="$style.legendItem">
			<span style="width: 8px; height: 2px;" :style="{ backgroundColor: item.color }"></span>
			<span style="opacity: 0.7;">{{ item.label }}</span>
			<span data-test-rendering-stat-average>{{ formatMs(current[item.key]) }}</span>
			<span v-if="isTimeline" data-test-rendering-stat-maximum :class="$style.maximum">({{ formatMs(maximum[item.key]) }})</span>
		</div>
	</div>
	<div v-if="isTimeline" data-test-timeline-statistics-hint :title="i18n.ts._Stats.TimelineTimingHint" :class="$style.hint">{{ i18n.ts._Stats.TimelineTimingSummary }}</div>
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
				:data-test-rendering-stat-line="item.key"
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
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { appContext } from '@/app.ts';
import { i18n } from '@/i18n.ts';
import type { TimelinePreviewFrameTiming, TimelinePreviewStatistics } from '@gs/glitch-studio_renderer/timeline-renderer-manager.ts';

const { visualModuleRendererManagerController, timelineRendererManagerController, previewPlayback } = appContext;

type SeriesKey = 'fast' | 'medium' | 'slow' | keyof TimelinePreviewFrameTiming;
type RenderTimes = Partial<Record<SeriesKey, number>>;
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

const isTimeline = computed(() => previewPlayback.state.value.mode === 'timeline');
const series = computed(() => isTimeline.value ? [
	{ key: 'frameDurationMs', label: i18n.ts._Stats.FrameDuration, description: i18n.ts._Stats.FrameDurationDescription, color: '#c2fe0c', strokeWidth: 2 },
	{ key: 'videoSampleWaitMs', label: i18n.ts._Stats.VideoSampleWait, description: i18n.ts._Stats.VideoSampleWaitDescription, color: '#55c8ff', strokeWidth: 1.5 },
	{ key: 'videoUploadCpuMs', label: i18n.ts._Stats.VideoUploadCpu, description: i18n.ts._Stats.VideoUploadCpuDescription, color: '#ffbd69', strokeWidth: 1.5 },
	{ key: 'gpuWaitMs', label: i18n.ts._Stats.GpuWait, description: i18n.ts._Stats.GpuWaitDescription, color: '#c98cff', strokeWidth: 1.5 },
] as const : [
	{ key: 'fast', label: 'fast', description: '', color: '#c2fe0c', strokeWidth: 1 },
	{ key: 'medium', label: 'medium', description: '', color: '#55c8ff', strokeWidth: 1.5 },
	{ key: 'slow', label: 'slow', description: '', color: '#c98cff', strokeWidth: 2 },
] as const);

const samples = ref<Sample[]>([]);
const current = ref<RenderTimes>({});
const maximum = ref<RenderTimes>({});
const maxMs = computed(() => Math.max(4, Math.ceil(Math.max(...samples.value.flatMap(sample => series.value.map(item => sample[item.key] ?? 0))) / 4) * 4));
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

let timer: number | null = null;
let resizeObserver: ResizeObserver | null = null;
let previousStatistics: TimelinePreviewStatistics | null = null;

function clearSamples() {
	samples.value = [];
	current.value = {};
	maximum.value = {};
	previousStatistics = null;
}

function recordSample() {
	const timestamp = performance.now();
	if (isTimeline.value) {
		const statistics = timelineRendererManagerController.previewStatistics.value;
		if (statistics == null) { clearSamples(); return; }
		// 一時停止中の同じ通知を新しいフレームとして記録しない。Workerは通知間の
		// 全フレームを集約するため、UIのサンプリングで短いスパイクも捨てない。
		if (statistics === previousStatistics) return;
		previousStatistics = statistics;
		current.value = statistics.average;
		maximum.value = statistics.maximum;
	} else {
		current.value = {
			fast: toMs(visualModuleRendererManagerController.gpuAverageDisplayFast.value),
			medium: toMs(visualModuleRendererManagerController.gpuAverageDisplayMedium.value),
			slow: toMs(visualModuleRendererManagerController.gpuAverageDisplaySlow.value),
		};
	}
	samples.value.push({ ...current.value, timestamp });
	while (samples.value[0]?.timestamp < timestamp - historyDuration || samples.value.length > sampleLimit) samples.value.shift();
}

function polylinePoints(key: SeriesKey) {
	const latestTimestamp = samples.value.at(-1)?.timestamp ?? 0;
	return samples.value.map(sample => {
		const x = plotLeft + (1 - (latestTimestamp - sample.timestamp) / historyDuration) * plotWidth.value;
		const y = plotTop + (1 - (sample[key] ?? 0) / maxMs.value) * plotHeight.value;
		return `${x},${y}`;
	}).join(' ');
}

function formatMs(value: number | null | undefined) {
	if (value == null) return '—';
	return `${value.toFixed(1)}ms`;
}

function toMs(value: number) {
	return Number.isFinite(value) && value >= 0 ? value / 1000 : 0;
}

watch(() => previewPlayback.state.value.mode, () => {
	clearSamples();
	recordSample();
});

watch(timelineRendererManagerController.previewStatistics, () => {
	if (isTimeline.value) recordSample();
}, { flush: 'sync' });

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
	overflow: auto;
}

.legend {
	display: flex;
	flex-wrap: wrap;
	gap: 10px 10px;
	padding: 0 0 8px 2px;
	font-size: 90%;
}

.legendItem {
	display: grid;
	grid-template-columns: 8px auto auto auto;
	align-items: center;
	gap: 6px;
}

.maximum {
	opacity: 0.6;
}

.hint {
	padding: 0 0 8px 2px;
	font-size: 85%;
	opacity: 0.7;
}

.chart {
	flex: 1 0 100px;
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
		font-size: 90%;
	}
}
</style>
