<template>
<div :class="$style.root">
	<div :class="$style.header">
	</div>
	<div :class="$style.body">
		<div :class="$style.side">
		</div>
		<div ref="tlEl" :class="$style.tl" tabindex="-1" @wheel="onTlWheel" @mousemove="onTlMousemove" @mousedown="onTlMousedown" @keydown="onTlKeydown">
			<div :class="$style.yTicks" @wheel="onYTicksWheel">
				<div v-for="valueY of yTicks" class="_monospace" :class="[$style.yTick, { [$style.yTickActive]: snappingY != null && nearlyEqual(snappingY, valueY) }]" :style="{ top: valueYToDomY(valueY) + 'px' }">{{ valueY.toFixed(2) }}</div>
			</div>
			<div :class="$style.xTicks" @wheel="onXTicksWheel">
				<div v-for="valueX of xTicks" :class="[$style.xTick, { [$style.xTickActive]: snappingX != null && nearlyEqual(snappingX, valueX) }]" class="_monospace" :style="{ left: valueXToDomX(valueX) + 'px' }">{{ formatValueXWithUnit(valueX) }}</div>
				<div :class="$style.xTicksSeekBar" :style="{ left: (seekBarPos - 1) + 'px' }" @mousedown="onSeekBarMousedown"></div>
			</div>
			<div :class="$style.ticksCorner"></div>
			<div :class="$style.tlRange" :style="{ width: tlRangeElWidth + 'px', left: tlRangeElPosX + 'px' }"></div>
			<div :class="$style.selectedArea" :style="{ width: selectedAreaElWidth + 'px', height: selectedAreaElHeight + 'px', bottom: selectedAreaElPosY + 'px', left: selectedAreaElPosX + 'px' }"></div>
			<div v-for="valueX of xTicks" :class="[$style.inTlXTick, { [$style.inTlXTickActive]: snappingX != null && nearlyEqual(snappingX, valueX) }]" :style="{ left: valueXToDomX(valueX) + 'px' }"></div>
			<div v-for="valueY of yTicks" :class="[$style.inTlYTick, { [$style.inTlYTickZero]: valueY.toFixed(2).replace('-', '') === '0.00', [$style.inTlYTickActive]: snappingY != null && nearlyEqual(snappingY, valueY) }]" :style="{ top: valueYToDomY(valueY) + 'px' }"></div>
			<div :class="$style.seekBar" class="_monospace" :style="{ left: seekBarPos + 'px' }"><div :class="$style.seekBarFrame">{{ formatValueXWithUnit(currentValueX) }}</div></div>
			<div :class="$style.valueBar" class="_monospace" :style="{ top: valueBarPos + 'px' }"><div :class="$style.valueBarValue">{{ currentValue.toFixed(2) }}</div></div>
			<div :class="$style.crossPoint" :style="{ left: seekBarPos + 'px', top: valueBarPos + 'px' }"></div>
			<div v-if="!bezierDragging" :class="$style.cursorBar" :style="{ left: cursorBarPos + 'px' }"></div>
			<div :class="$style.automationGraph">
				<svg version="1.1" :viewBox="`0 0 ${tlElWidth} ${tlElHeight}`" :class="$style.lines">
					<defs>
						<linearGradient id="tlAutomationGraphGradient" x1="0" x2="0" y1="0" y2="1">
							<stop offset="0%" stop-color="var(--accentAlphaMiddleLow)"/>
							<stop :offset="automationGraphPathGradientCenter + '%'" stop-color="var(--accentAlphaVeryLow)"/>
							<stop offset="100%" stop-color="var(--accentAlphaMiddleLow)"/>
						</linearGradient>
					</defs>
					<path :d="automationGraphSvgFillPath" style="fill: url(#tlAutomationGraphGradient); stroke: none;"/>
					<path :d="automationGraphSvgPath" style="stroke: currentColor; fill: none; stroke-width: 2;"/>
				</svg>

				<svg v-if="!nowSelecting && selectedPoint" version="1.1" :viewBox="`0 0 ${tlElWidth} ${tlElHeight}`" :class="$style.lines">
					<line
						v-if="bezierHandleADomPos"
						:x1="valueXToDomX(selectedPoint.x)"
						:y1="valueYToDomY(selectedPoint.y)"
						:x2="bezierHandleADomPos[0]"
						:y2="bezierHandleADomPos[1]"
						style="stroke: var(--THEME-accentSecondary); stroke-width: 1;"
					/>
					<line
						v-if="bezierHandleBDomPos"
						:x1="valueXToDomX(selectedPoint.x)"
						:y1="valueYToDomY(selectedPoint.y)"
						:x2="bezierHandleBDomPos[0]"
						:y2="bezierHandleBDomPos[1]"
						style="stroke: var(--THEME-accentSecondary); stroke-width: 1;"
					/>
				</svg>

				<div
					v-for="point of ppints"
					:class="[$style.point, { [$style.selectedPoint]: selectedPoints.includes(point) }]"
					:style="{ left: valueXToDomX(point.x) + 'px', top: valueYToDomY(point.y) + 'px' }"
					@mousedown="onPointMousedown($event, point)"
					@contextmenu="onPointContextmenu($event, point)"
				>
					<div :class="$style.pointTooltip" class="_monospace">
						<div>X: {{ formatValueXWithUnit(point.x) }}</div>
						<div>Y: {{ point.y.toFixed(2) }}</div>
					</div>
				</div>
			</div>

			<div v-if="(nowSelecting || selectedPoints.length === 0) && tooltipDomPos" :class="$style.tooltip" class="_monospace" :style="{ left: tooltipDomPos[0] + 'px', top: tooltipDomPos[1] + 'px' }">
				<div>X: {{ formatValueXWithUnit(cursorValueX) }}</div>
				<div>Y: {{ cursorValueY }}</div>
			</div>

			<div v-if="!nowSelecting && contextmenuPoint && pointContextmenuDomPos" :class="$style.pointContextmenu" :style="{ left: pointContextmenuDomPos[0] + 'px', top: pointContextmenuDomPos[1] + 'px' }">
				<div>
					<div :class="$style.pointContextmenuHandle" style="cursor: ns-resize;" @mousedown="onPointYHandleMousedown"><i class="ti ti-arrows-vertical"></i></div>
					<div :class="$style.pointContextmenuInput">V: {{ contextmenuPoint.y.toFixed(2) }}</div>
				</div>
				<div>
					<div :class="$style.pointContextmenuHandle" style="cursor: ew-resize;" @mousedown="onPointXHandleMousedown"><i class="ti ti-arrows-horizontal"></i></div>
					<div :class="$style.pointContextmenuInput">F: {{ contextmenuPoint.x }}</div>
				</div>
			</div>

			<div v-if="!nowSelecting && !isBezierAZero && bezierHandleADomPos" :class="$style.bezierHandle" :style="{ left: bezierHandleADomPos[0] + 'px', top: bezierHandleADomPos[1] + 'px' }" @mousedown="onBezierHandleAMousedown">
			</div>
			<div v-if="!nowSelecting && !isBezierBZero && bezierHandleBDomPos" :class="$style.bezierHandle" :style="{ left: bezierHandleBDomPos[0] + 'px', top: bezierHandleBDomPos[1] + 'px' }" @mousedown="onBezierHandleBMousedown">
			</div>

			<template v-if="bezierDragging">
				<div
					v-for="line of bezierSnapLinesX"
					:class="[$style.bezierSnapLineX, { [$style.bezierSnapLineXActive]: line.active }]"
					:style="{ left: line.x + 'px' }"
				></div>
				<div
					v-for="line of bezierSnapLinesY"
					:class="[$style.bezierSnapLineY, { [$style.bezierSnapLineYActive]: line.active }]"
					:style="{ left: line.x + 'px', top: line.y + 'px', width: line.width + 'px' }"
				></div>
			</template>

			<div :class="$style.infoBar" class="_monospace">
				<div><b>TL Offset</b>{{ tlPosX.toFixed(2) }}, {{ tlPosY.toFixed(2) }}</div>
				<div><b>Cursor</b>{{ cursorValueX.toFixed(2) }}, {{ cursorValueY }}</div>
				<div><b>Current</b>{{ currentValueX.toFixed(2) }}, {{ currentValue.toFixed(2) }}</div>
				<div><b>Min/Max</b>{{ minMaxValuesInTheAutomationGraph.min.toFixed(2) }}, {{ minMaxValuesInTheAutomationGraph.max.toFixed(2) }}</div>
			</div>
		</div>
		<div v-if="selectedPoint" :class="$style.rightSidePanel">
			<div>Bezier</div>
			<GsButton :primary="!isBezierAZero" @click="toggleBezierA">A</GsButton>
			<GsButton :primary="!isBezierBZero" @click="toggleBezierB">B</GsButton>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { evalAutomationGraphValue, insertIntermediateNumbers, nearlyEqual, niceScale } from '@glitch/shared/utility/misc.js';
import { genId } from '@glitch/shared/utility/id.js';
import { deepClone } from '@glitch/shared/utility/deep-clone.js';
import GsButton from './common/GsButton.vue';
import type { GsAutomationGraph, GsBezierAnchorPoint } from '@glitch/shared/types.js';
import { dragListen } from '@/utility/drag.ts';

// TODO: dom座標としてのx/yとpointの値としてのx/yは同じ数値ではあるが意味が異なるので、Phantom Typeなどで区別する

const X_TICKS_HEIGHT = 20;
const Y_TICKS_WIDTH = 60;

const props = defineProps<{
	points: GsBezierAnchorPoint[];
	isNormalized: boolean;
}>();

const ppints = ref(deepClone(props.points));

function isFixedEndpoint(point: GsBezierAnchorPoint): boolean {
	return props.isNormalized && (point === ppints.value[0] || point === ppints.value[ppints.value.length - 1]);
}

// 最も長いxをもつpointのx
const duration = computed(() => {
	return ppints.value.reduce((max, kf) => Math.max(max, kf.x), 0) ?? 0;
});
const currentValueX = ref(0);

function toMs(value: number): number {
	// 便宜的に1=10秒として扱う
	return value * 10000;
}

const tlEl = useTemplateRef('tlEl');
const tlElWidth = ref(0);
const tlElHeight = ref(0);
const tlRangeX = ref(props.isNormalized ? 2 : toMs(2));
const tlRangeY = ref(5);
const tlPosX = ref(props.isNormalized ? -0.5 : toMs(-0.5));
const tlPosY = ref(-2.5);
const snappingX = ref<number | null>(null);
const snappingY = ref<number | null>(null);
const selectedPoints = ref<GsBezierAnchorPoint[]>([]);
const selectedPoint = computed(() => selectedPoints.value.length === 1 ? selectedPoints.value[0] : null);
const contextmenuPoint = ref<GsBezierAnchorPoint | null>(null);
const seekBarPos = computed(() => {
	return valueXToDomX(currentValueX.value);
});
const currentValue = computed(() => {
	return evalAutomationGraphValue({ points: ppints.value }, currentValueX.value, 'clamp');
});
const valueBarPos = computed(() => {
	return valueYToDomY(currentValue.value);
});
const cursorBarPos = ref(0);
const tlRangeElPosX = computed(() => {
	return -((tlPosX.value / tlRangeX.value) * tlElWidth.value);
});
const tlRangeElWidth = computed(() => {
	return (duration.value / tlRangeX.value) * tlElWidth.value;
});
const tooltipDomPos = ref<null | [number, number]>(null);
const pointContextmenuDomPos = computed(() => {
	if (!contextmenuPoint.value) return null;
	return [
		valueXToDomX(contextmenuPoint.value.x) + 5,
		valueYToDomY(contextmenuPoint.value.y) + 5,
	];
});
const bezierHandleADomPos = computed(() => {
	if (!selectedPoint.value) return null;
	return [
		logicalXToDomX(selectedPoint.value.x + selectedPoint.value.bezierControlPointA[0]),
		logicalYToDomY(selectedPoint.value.y + selectedPoint.value.bezierControlPointA[1]),
	];
});
const bezierHandleBDomPos = computed(() => {
	if (!selectedPoint.value) return null;
	return [
		logicalXToDomX(selectedPoint.value.x + selectedPoint.value.bezierControlPointB[0]),
		logicalYToDomY(selectedPoint.value.y + selectedPoint.value.bezierControlPointB[1]),
	];
});
const isBezierAZero = computed(() => {
	if (!selectedPoint.value) return false;
	return selectedPoint.value.bezierControlPointA[0] === 0 && selectedPoint.value.bezierControlPointA[1] === 0;
});
const isBezierBZero = computed(() => {
	if (!selectedPoint.value) return false;
	return selectedPoint.value.bezierControlPointB[0] === 0 && selectedPoint.value.bezierControlPointB[1] === 0;
});
const cursorValueX = ref(0);
const cursorValueY = ref(0);
const nowSelecting = ref(false);
const selectedAreaPosX = ref(0);
const selectedAreaPosY = ref(0);
const selectedAreaWidth = ref(0);
const selectedAreaHeight = ref(0);
const selectedAreaElPosX = computed(() => {
	return ((selectedAreaPosX.value - tlPosX.value) / tlRangeX.value) * tlElWidth.value;
});
const selectedAreaElPosY = computed(() => {
	return ((selectedAreaPosY.value - tlPosY.value) / tlRangeY.value) * tlElHeight.value;
});
const selectedAreaElWidth = computed(() => {
	return ((selectedAreaWidth.value) / tlRangeX.value) * tlElWidth.value;
});
const selectedAreaElHeight = computed(() => {
	return (((selectedAreaHeight.value) / tlRangeY.value) * tlElHeight.value);
});

const bezierDragging = ref(false);
const bezierSnapLinesX = ref<{ active?: boolean; x: number }[]>([]);
const bezierSnapLinesY = ref<{ active?: boolean; x: number; y: number; width: number }[]>([]);

// TODO: TLの表示DOMサイズに応じて変更
const xTicksCount = ref(10);
const xTicks = computed(() => niceScale(tlPosX.value, tlPosX.value + tlRangeX.value, xTicksCount.value));
const xTicksWithHalf = computed(() => insertIntermediateNumbers(xTicks.value));
const yTicksCount = ref(6);
const yTicks = computed(() => niceScale(tlPosY.value, tlPosY.value + tlRangeY.value, yTicksCount.value));
const yTicksWithHalf = computed(() => insertIntermediateNumbers(yTicks.value));

const minMaxValuesInTheAutomationGraph = computed(() => {
	// 塗りつぶしは値0まで閉じるため、範囲に0も含める。
	// Xを整数刻みで評価すると0〜1のカーブを始点でしか評価できない。
	// SVGと同じ三次ベジェの端点と極値を使い、Xの単位や長さに依存させない。
	let min = 0;
	let max = 0;
	const include = (value: number) => {
		min = Math.min(min, value);
		max = Math.max(max, value);
	};
	for (const point of ppints.value) include(point.y);
	for (let i = 0; i < ppints.value.length - 1; i++) {
		const start = ppints.value[i];
		const end = ppints.value[i + 1];
		const y0 = start.y;
		const y1 = start.y + start.bezierControlPointB[1];
		const y2 = end.y + end.bezierControlPointA[1];
		const y3 = end.y;
		// y'(t) / 3 = a*t² + b*t + c。区間内の解だけが曲線の極値候補になる。
		const a = -y0 + 3 * y1 - 3 * y2 + y3;
		const b = 2 * (y0 - 2 * y1 + y2);
		const c = y1 - y0;
		const discriminant = b * b - 4 * a * c;
		const roots = a === 0
			? (b === 0 ? [] : [-c / b])
			: discriminant < 0 ? [] : [(-b + Math.sqrt(discriminant)) / (2 * a), (-b - Math.sqrt(discriminant)) / (2 * a)];
		for (const t of roots) {
			if (t <= 0 || t >= 1) continue;
			const u = 1 - t;
			include(u ** 3 * y0 + 3 * u ** 2 * t * y1 + 3 * u * t ** 2 * y2 + t ** 3 * y3);
		}
	}
	return {
		min,
		max,
	};
});

const automationGraphSvgPath = computed(() => {
	const points = ppints.value;
	if (points.length === 0) return '';
	let d = `M ${valueXToDomX(points[0].x)}, ${valueYToDomY(points[0].y)}`;
	for (let i = 0; i < points.length - 1; i++) {
		const point = points[i];
		const dx1 = valueXToDomX(Math.min(points[i + 1].x, point.x + (point.bezierControlPointB[0])));
		const dy1 = valueYToDomY(point.y + (point.bezierControlPointB[1]));
		const dx2 = valueXToDomX(Math.max(point.x, points[i + 1].x + (points[i + 1].bezierControlPointA[0])));
		const dy2 = valueYToDomY(points[i + 1].y + (points[i + 1].bezierControlPointA[1]));
		const dx = valueXToDomX(points[i + 1].x);
		const dy = valueYToDomY(points[i + 1].y);
		d += ` C ${dx1}, ${dy1} ${dx2}, ${dy2} ${dx}, ${dy}`;
	}
	return d;
});
const automationGraphSvgFillPath = computed(() => {
	const points = ppints.value;
	if (points.length === 0) return '';
	// 値0へ閉じる線は塗りつぶし専用にし、曲線のstrokeには含めない。
	return `${automationGraphSvgPath.value} L ${valueXToDomX(points[points.length - 1].x)}, ${valueYToDomY(0)} L ${valueXToDomX(0)}, ${valueYToDomY(0)} Z`;
});
const automationGraphPathGradientCenter = computed(() => {
	const max = minMaxValuesInTheAutomationGraph.value.max;
	const min = Math.min(0, minMaxValuesInTheAutomationGraph.value.min);
	if (max === 0 && min === 0) return 0;
	return ((max) / (max + Math.abs(min))) * 100;
});

function valueXToDomX(x: number): number {
	return ((x - tlPosX.value) / tlRangeX.value) * tlElWidth.value;
}

function valueYToDomY(y: number): number {
	return tlElHeight.value - (((y - tlPosY.value) / tlRangeY.value) * tlElHeight.value);
}

function logicalXToDomX(x: number): number {
	return valueXToDomX(x);
}

function logicalYToDomY(y: number): number {
	return valueYToDomY(y);
}

function domXToLogicalX(x: number): number {
	return ((x / tlElWidth.value) * tlRangeX.value);
}

function domXToValueX(x: number): number {
	return domXToLogicalX(x) + tlPosX.value;
}

function domYToLogicalY(y: number): number {
	return ((1 - (y / tlElHeight.value)) * tlRangeY.value);
}

function domYToValueY(y: number): number {
	return domYToLogicalY(y) + tlPosY.value;
}

function addPoint(x: number, y: number): GsBezierAnchorPoint | undefined {
	// 正規化された曲線の両端は既存のポイントで維持する。貼り付けも同じ制限に従う。
	if (props.isNormalized && (x <= 0 || x >= 1)) return;
	const _points = [] as GsBezierAnchorPoint[];
	const point: GsBezierAnchorPoint = {
		id: genId(),
		x,
		y,
		bezierControlPointA: [props.isNormalized ? -0.1 : toMs(-0.1), 0],
		bezierControlPointB: [props.isNormalized ? 0.1 : toMs(0.1), 0],
	};
	let pushed = false;
	if (ppints.value.filter(kf => kf.x === x).length > 1) return;
	for (const kf of ppints.value) {
		if (!pushed && kf.x > x) {
			_points.push(point);
			_points.push(kf);
			pushed = true;
		} else {
			_points.push(kf);
		}
	}
	if (!pushed) {
		_points.push(point);
	}
	ppints.value = _points;
	return point;
}

function onTlMousemove(ev: MouseEvent) {
	if (tlEl.value === null) return;
	const rect = tlEl.value.getBoundingClientRect();
	const mouseX = ev.clientX - rect.left;
	const mouseY = ev.clientY - rect.top;
	const valueX = domXToValueX(mouseX);
	cursorBarPos.value = valueXToDomX(valueX);

	const value = domYToValueY(mouseY);
	cursorValueY.value = Number(value.toFixed(2));
	cursorValueX.value = valueX;
	tooltipDomPos.value = [mouseX + 10, mouseY + 10];
}

function onTlWheel(ev: WheelEvent) {
	if (tlEl.value === null) return;
	ev.preventDefault();

	const rect = tlEl.value.getBoundingClientRect();
	const x = ev.clientX - rect.left;
	const y = ev.clientY - rect.top;
	const anchorTime = domXToLogicalX(x) + tlPosX.value;
	const anchorValue = domYToValueY(y);

	tlRangeX.value *= 1 + (ev.deltaY / 1000);
	tlRangeY.value *= 1 + (ev.deltaY / 1000);

	// 拡大・縮小前にカーソル直下にあった時刻・値が、同じ画面位置に留まるように補正する。
	tlPosX.value = anchorTime - domXToLogicalX(x);
	tlPosY.value = anchorValue - domYToLogicalY(y);
}

function onXTicksWheel(ev: WheelEvent) {
	if (tlEl.value === null) return;
	ev.preventDefault();
	ev.stopPropagation();

	const rect = tlEl.value.getBoundingClientRect();
	const x = ev.clientX - rect.left;
	const anchorTime = domXToLogicalX(x) + tlPosX.value;

	tlRangeX.value *= 1 + (ev.deltaY / 1000);
	tlPosX.value = anchorTime - domXToLogicalX(x);
}

function onYTicksWheel(ev: WheelEvent) {
	if (tlEl.value === null) return;
	ev.preventDefault();
	ev.stopPropagation();

	const rect = tlEl.value.getBoundingClientRect();
	const y = ev.clientY - rect.top;
	const anchorValue = domYToValueY(y);

	tlRangeY.value *= 1 + (ev.deltaY / 1000);
	tlPosY.value = anchorValue - domYToLogicalY(y);
}

function onTlDblclick(ev: MouseEvent) {
	if (tlEl.value === null) return;
	if (ev.button === 1) return;

	const rect = tlEl.value.getBoundingClientRect();
	const clickX = ev.clientX - rect.left;
	const clickY = ev.clientY - rect.top;
	const valueX = domXToValueX(clickX);
	let valueY = domYToValueY(clickY);

	// snap
	for (const step of [...yTicksWithHalf.value, 1]) { // 1は重要なのでどんな時でもスナップ候補
		const stepY = valueYToDomY(step);
		if (clickY > stepY - SNAP_THRESHOLD && clickY < stepY + SNAP_THRESHOLD) {
			valueY = step;
			break;
		}
	}

	const point = addPoint(valueX, valueY);
	if (point == null) return;

	selectedPoints.value = [point];

	onPointMousedown(ev, point);
}

let beforeClickedAt = 0;

function onTlMousedown(ev: MouseEvent) {
	if (tlEl.value === null) return;
	ev.preventDefault();
	tlEl.value.focus();

	if (ev.button === 1) {
		ev.preventDefault();
		const position = tlEl.value.getBoundingClientRect();
		const moveBaseX = ev.clientX - position.left;
		const moveBaseY = ev.clientY - position.top;
		const baseTlPosX = tlPosX.value;
		const baseTlPosY = tlPosY.value;

		function move(x: number, y: number) {
			tlPosX.value = baseTlPosX + (domXToLogicalX(moveBaseX) - domXToLogicalX(x));
			tlPosY.value = baseTlPosY + (domYToLogicalY(moveBaseY) - domYToLogicalY(y));
		}

		dragListen(me => {
			move(me.clientX - position.left, me.clientY - position.top);
		});
		return;
	}

	if (ev.button === 2) return;

	// ダブルクリック判定
	if (Date.now() - beforeClickedAt < 300) {
		beforeClickedAt = Date.now();
		onTlDblclick(ev);
		return;
	}

	beforeClickedAt = Date.now();

	selectedPoints.value = [];
	contextmenuPoint.value = null;

	const position = tlEl.value.getBoundingClientRect();
	const moveBaseX = ev.clientX - position.left;
	const moveBaseY = ev.clientY - position.top;

	function move(x: number, y: number) {
		const originFrame = domXToValueX(Math.min(moveBaseX, x));
		const targetFrame = domXToValueX(Math.max(moveBaseX, x));
		const originValue = domYToValueY(Math.max(moveBaseY, y));
		const targetValue = domYToValueY(Math.min(moveBaseY, y));
		selectedAreaPosX.value = originFrame;
		selectedAreaPosY.value = originValue;
		selectedAreaWidth.value = targetFrame - originFrame;
		selectedAreaHeight.value = targetValue - originValue;

		selectedPoints.value = ppints.value.filter(kf =>
			kf.x >= originFrame && kf.x <= targetFrame && kf.y >= originValue && kf.y <= targetValue,
		);
	}

	nowSelecting.value = true;
	dragListen(me => {
		move(me.clientX - position.left, me.clientY - position.top);
	}, () => {
		nowSelecting.value = false;
		selectedAreaPosX.value = 0;
		selectedAreaPosY.value = 0;
		selectedAreaWidth.value = 0;
		selectedAreaHeight.value = 0;
	});
}

const SNAP_THRESHOLD = 5;

function onPointsXYHandleMousedown(ev: MouseEvent, point: GsBezierAnchorPoint, treatX: boolean, treatY: boolean) {
	if (tlEl.value == null) return;
	ev.stopPropagation();
	const prevPoint = ppints.value[ppints.value.indexOf(selectedPoints.value[0]) - 1];
	const nextPoint = ppints.value[ppints.value.indexOf(selectedPoints.value[selectedPoints.value.length - 1]) + 1];
	const position = tlEl.value.getBoundingClientRect();
	const moveBaseX = ev.clientX - position.left;
	const moveBaseY = ev.clientY - position.top;
	const baseTime = point.x;
	const baseValue = point.y;
	const baseFrames = selectedPoints.value.map(point => point.x);
	const baseValues = selectedPoints.value.map(point => point.y);
	const firstFrameOffset = baseTime - baseFrames[0];
	const lastFrameOffset = baseTime - baseFrames[baseFrames.length - 1];

	function move(x: number, y: number) {
		let baseNewTime = treatX ? Math.max((prevPoint?.x ?? -Infinity) + firstFrameOffset, Math.min((nextPoint?.x ?? Infinity) + lastFrameOffset, baseTime + (domXToValueX(x) - domXToValueX(moveBaseX)))) : baseTime;
		let baseNewValue = treatY ? baseValue + (domYToValueY(y) - domYToValueY(moveBaseY)) : baseValue;

		snappingX.value = null;
		if (treatX && !isFixedEndpoint(point)) {
			const draggedX = valueXToDomX(baseTime) + (x - moveBaseX);
			const minX = Math.max(0, (prevPoint?.x ?? -Infinity) + firstFrameOffset);
			const maxX = Math.min(props.isNormalized ? 1 : Infinity, (nextPoint?.x ?? Infinity) + lastFrameOffset);
			const candidates = [...xTicksWithHalf.value, prevPoint?.x, nextPoint?.x, 0, ...(props.isNormalized ? [1] : [])];
			let nearestDistance = SNAP_THRESHOLD;
			for (const step of candidates) {
				// スナップで隣のポイントを越えたり、固定範囲の外へ移動したりしない。
				if (step == null || step < minX || step > maxX) continue;
				const distance = Math.abs(draggedX - valueXToDomX(step));
				if (distance >= nearestDistance) continue;
				nearestDistance = distance;
				baseNewTime = step;
				snappingX.value = step;
			}
		}

		if (treatY) {
			snappingY.value = null;
			// snap
			for (const step of [...yTicksWithHalf.value, prevPoint?.y ?? 1, nextPoint?.y ?? 1, 1]) { // 1は重要なのでどんな時でもスナップ候補
				const stepY = valueYToDomY(step);
				if (valueYToDomY(baseValue) + (y - moveBaseY) > stepY - SNAP_THRESHOLD && valueYToDomY(baseValue) + (y - moveBaseY) < stepY + SNAP_THRESHOLD) {
					baseNewValue = step;
					snappingY.value = step;
					break;
				}
			}

			// TODO: 比率を維持して制御点を再スケール
			//point.bezierControlPointA[1] = ?
			//point.bezierControlPointB[1] = ?
		}

		for (let i = 0; i < selectedPoints.value.length; i++) {
			const point = selectedPoints.value[i];
			// 複数選択でも端点のXは動かさず、Yの変更は通常どおり適用する。
			if (treatX && !isFixedEndpoint(point)) {
				point.x = Math.max(0, Math.min(props.isNormalized ? 1 : Infinity, baseNewTime + (baseFrames[i] - baseTime)));
			}
			if (treatY) point.y = baseNewValue + (baseValues[i] - baseValue);
		}
	}

	dragListen(me => {
		move(me.clientX - position.left, me.clientY - position.top);
	}, () => {
		snappingX.value = null;
		snappingY.value = null;
	});
}

function onPointXHandleMousedown(ev: MouseEvent) {
	if (contextmenuPoint.value == null) return;
	ev.stopPropagation();
	onPointsXYHandleMousedown(ev, contextmenuPoint.value, true, false);
}

function onPointYHandleMousedown(ev: MouseEvent) {
	if (contextmenuPoint.value == null) return;
	ev.stopPropagation();
	onPointsXYHandleMousedown(ev, contextmenuPoint.value, false, true);
}

function onPointMousedown(ev: MouseEvent, point: GsBezierAnchorPoint) {
	ev.stopPropagation();
	if (ev.button !== 0) return;

	if (selectedPoints.value.length === 0) {
		selectedPoints.value = [point];
	} else if (!selectedPoints.value.includes(point)) {
		selectedPoints.value = [point];
	}

	onPointsXYHandleMousedown(ev, point, true, true);
}

function onPointContextmenu(ev: MouseEvent, point: GsBezierAnchorPoint) {
	ev.preventDefault();
	ev.stopPropagation();

	if (selectedPoints.value.length === 0) {
		selectedPoints.value = [point];
	} else if (!selectedPoints.value.includes(point)) {
		selectedPoints.value = [point];
	}

	contextmenuPoint.value = point;
}

const BEZIER_SNAP_THRESHOLD = 8;
const BEZIER_X_SNAP_STEPS = [0, 0.25, 0.5, 0.75, 1];
const BEZIER_Y_SNAP_STEPS = [-2, -1.5, -1, -0.5, 0, 0.5, 1];

function onBezierHandleAMousedown(ev: MouseEvent) {
	const selected = selectedPoint.value;
	if (selected == null || tlEl.value == null) return;
	ev.stopPropagation();
	const point = selected;
	if (!ppints.value.includes(point)) return;
	const prevPoint = ppints.value[ppints.value.indexOf(selected) - 1];
	if (prevPoint == null) return;
	const position = tlEl.value.getBoundingClientRect();
	const moveBaseX = ev.clientX - position.left;
	const moveBaseY = ev.clientY - position.top;
	const baseTime = point.x;
	const baseValue = point.y;
	const baseControlPointX = point.bezierControlPointA[0];
	const baseControlPointY = point.bezierControlPointA[1];

	bezierSnapLinesX.value = BEZIER_X_SNAP_STEPS.map(step => ({
		x: valueXToDomX(point.x - ((point.x - prevPoint.x) * step)),
	}));
	bezierSnapLinesY.value = BEZIER_Y_SNAP_STEPS.map(step => ({
		x: valueXToDomX(prevPoint.x),
		y: valueYToDomY(point.y - ((prevPoint.y - point.y) * step)),
		width: valueXToDomX(point.x) - valueXToDomX(prevPoint.x),
	}));

	function move(x: number, y: number) {
		point.bezierControlPointA = [
			Math.min(0, baseControlPointX + ((domXToLogicalX(x) - domXToLogicalX(moveBaseX)))),
			baseControlPointY + ((domYToLogicalY(y) - domYToLogicalY(moveBaseY))),
		];

		for (const line of bezierSnapLinesX.value) {
			line.active = false;
		}
		for (const line of bezierSnapLinesY.value) {
			line.active = false;
		}

		// snap
		const domX = logicalXToDomX(point.x + point.bezierControlPointA[0]);
		for (let i = 0; i < BEZIER_X_SNAP_STEPS.length; i++) {
			const step = BEZIER_X_SNAP_STEPS[i];
			const stepX = valueXToDomX(baseTime - ((baseTime - prevPoint.x) * step));
			if (domX > stepX - BEZIER_SNAP_THRESHOLD && domX < stepX + BEZIER_SNAP_THRESHOLD) {
				point.bezierControlPointA[0] = 0 - ((baseTime - prevPoint.x) * step);
				bezierSnapLinesX.value[i].active = true;
				break;
			}
		}
		const domY = logicalYToDomY(point.y + point.bezierControlPointA[1]);
		for (let i = 0; i < BEZIER_Y_SNAP_STEPS.length; i++) {
			const step = BEZIER_Y_SNAP_STEPS[i];
			const stepY = valueYToDomY(baseValue - ((prevPoint.y - baseValue) * step));
			if (domY > stepY - BEZIER_SNAP_THRESHOLD && domY < stepY + BEZIER_SNAP_THRESHOLD) {
				point.bezierControlPointA[1] = (baseValue - prevPoint.y) * step;
				bezierSnapLinesY.value[i].active = true;
				break;
			}
		}
	}

	bezierDragging.value = true;

	dragListen(me => {
		move(me.clientX - position.left, me.clientY - position.top);
	}, () => {
		bezierDragging.value = false;
		bezierSnapLinesX.value = [];
		bezierSnapLinesY.value = [];
	});
}

function onBezierHandleBMousedown(ev: MouseEvent) {
	const selected = selectedPoint.value;
	if (selected == null || tlEl.value == null) return;
	ev.stopPropagation();
	const point = selected;
	if (!ppints.value.includes(point)) return;
	const nextPoint = ppints.value[ppints.value.indexOf(selected) + 1];
	if (nextPoint == null) return;
	const position = tlEl.value.getBoundingClientRect();
	const moveBaseX = ev.clientX - position.left;
	const moveBaseY = ev.clientY - position.top;
	const baseTime = point.x;
	const baseValue = point.y;
	const baseControlPointX = point.bezierControlPointB[0];
	const baseControlPointY = point.bezierControlPointB[1];

	bezierSnapLinesX.value = BEZIER_X_SNAP_STEPS.map(step => ({
		x: valueXToDomX(point.x - ((point.x - nextPoint.x) * step)),
	}));
	bezierSnapLinesY.value = BEZIER_Y_SNAP_STEPS.map(step => ({
		x: valueXToDomX(point.x),
		y: valueYToDomY(point.y - ((nextPoint.y - point.y) * step)),
		width: valueXToDomX(nextPoint.x) - valueXToDomX(point.x),
	}));

	function move(x: number, y: number) {
		point.bezierControlPointB = [
			Math.max(0, baseControlPointX + ((domXToLogicalX(x) - domXToLogicalX(moveBaseX)))),
			baseControlPointY + ((domYToLogicalY(y) - domYToLogicalY(moveBaseY))),
		];

		for (const line of bezierSnapLinesX.value) {
			line.active = false;
		}
		for (const line of bezierSnapLinesY.value) {
			line.active = false;
		}

		// snap
		const domX = logicalXToDomX(point.x + point.bezierControlPointB[0]);
		for (let i = 0; i < BEZIER_X_SNAP_STEPS.length; i++) {
			const step = BEZIER_X_SNAP_STEPS[i];
			const stepX = valueXToDomX(baseTime - ((baseTime - nextPoint.x) * step));
			if (domX > stepX - BEZIER_SNAP_THRESHOLD && domX < stepX + BEZIER_SNAP_THRESHOLD) {
				point.bezierControlPointB[0] = 0 - ((baseTime - nextPoint.x) * step);
				bezierSnapLinesX.value[i].active = true;
				break;
			}
		}
		const domY = logicalYToDomY(point.y + point.bezierControlPointB[1]);
		for (let i = 0; i < BEZIER_Y_SNAP_STEPS.length; i++) {
			const step = BEZIER_Y_SNAP_STEPS[i];
			const stepY = valueYToDomY(baseValue - ((nextPoint.y - baseValue) * step));
			if (domY > stepY - BEZIER_SNAP_THRESHOLD && domY < stepY + BEZIER_SNAP_THRESHOLD) {
				point.bezierControlPointB[1] = (baseValue - nextPoint.y) * step;
				bezierSnapLinesY.value[i].active = true;
				break;
			}
		}
	}

	bezierDragging.value = true;

	dragListen(me => {
		move(me.clientX - position.left, me.clientY - position.top);
	}, () => {
		bezierDragging.value = false;
		bezierSnapLinesX.value = [];
		bezierSnapLinesY.value = [];
	});
}

function onSeekBarMousedown(ev: MouseEvent) {
	if (tlEl.value == null) return;
	ev.stopPropagation();
	const position = tlEl.value.getBoundingClientRect();

	function move(x: number, y: number) {
		let valueX = domXToValueX(x);
		valueX = Math.min(Math.max(0, valueX), duration.value);
		currentValueX.value = valueX;
	}

	dragListen(me => {
		move(me.clientX - position.left, me.clientY - position.top);
	});
}

function deletePoint(point: GsBezierAnchorPoint) {
	if (isFixedEndpoint(point)) return;
	const index = ppints.value.indexOf(point);
	if (index === -1) return;
	ppints.value.splice(index, 1);
}

let copyingPoints: GsBezierAnchorPoint[] | null = null;

function onTlKeydown(ev: KeyboardEvent) {
	console.log(ev.key, ev.ctrlKey);
	if (ev.key === 'Backspace') {
		const kfs = selectedPoints.value;
		selectedPoints.value = [];
		contextmenuPoint.value = null;
		for (const kf of kfs) {
			deletePoint(kf);
		}
	} else if (ev.ctrlKey && ev.key === 'c') {
		copyingPoints = JSON.parse(JSON.stringify(selectedPoints.value));
	} else if (ev.ctrlKey && ev.key === 'v') {
		if (copyingPoints == null || copyingPoints.length === 0) return;
		const baseTime = copyingPoints[0].x;
		for (const kf of copyingPoints) {
			addPoint(cursorValueX.value + (kf.x - baseTime), kf.y);
		}
	}
}

function toggleBezierA() {
	if (selectedPoint.value == null) return;
	if (isBezierAZero.value) {
		selectedPoint.value.bezierControlPointA = [-1000, 0];
	} else {
		selectedPoint.value.bezierControlPointA = [0, 0];
	}
}

function toggleBezierB() {
	if (selectedPoint.value == null) return;
	if (isBezierBZero.value) {
		selectedPoint.value.bezierControlPointB = [1000, 0];
	} else {
		selectedPoint.value.bezierControlPointB = [0, 0];
	}
}

function formatValueXWithUnit(x: number): string {
	if (props.isNormalized) {
		return x.toFixed(2);
	} else {
		const totalSeconds = Math.floor(x / 1000);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		const milliseconds = x % 1000;
		if (milliseconds === 0) {
			return `${minutes}:${seconds.toString().padStart(2, '0')}`;
		} else {
			return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().replace(/0+$/, '')}`;
		}
	}
}

onMounted(() => {
	if (tlEl.value === null) return;
	tlElWidth.value = tlEl.value.offsetWidth;
	tlElHeight.value = tlEl.value.offsetHeight;

	const resizeObserver = new ResizeObserver(() => {
		if (tlEl.value === null) return;
		tlElWidth.value = tlEl.value.offsetWidth;
		tlElHeight.value = tlEl.value.offsetHeight;
	});

	resizeObserver.observe(tlEl.value);
});
</script>

<style module lang="scss">
.root {
	position: relative;
	display: flex;
	flex-direction: column;
	height: 100%;
	contain: content;

	--xTicksHeight: v-bind('X_TICKS_HEIGHT + "px"');
	--yTicksWidth: v-bind('Y_TICKS_WIDTH + "px"');

	--accentAlphaMiddle: color(from var(--THEME-accent) srgb r g b / 0.5);
	--accentAlphaLow: color(from var(--THEME-accent) srgb r g b / 0.25);
	--accentAlphaMiddleLow: color(from var(--THEME-accent) srgb r g b / 0.35);
	--accentAlphaVeryLow: color(from var(--THEME-accent) srgb r g b / 0);
}

.header {
	display: flex;
	//height: 32px;
	//line-height: 32px;
}

.body {
	flex: 1;
	display: flex;
}

.side {
}

.yTicks {
	position: absolute;
	z-index: 1000;
	top: 0;
	left: 0;
	height: 100%;
	width: var(--yTicksWidth);
	background: #181818aa;
	backdrop-filter: blur(24px);
	overflow: clip;
	contain: content;
}
.yTick {
	position: absolute;
	left: 0;
	width: 100%;
	font-size: 12px;
	padding: 4px 8px 0 0;
	box-sizing: border-box;
	border-top: solid 1px #fff1;
	text-align: right;
}
.yTickActive {
	border-top: solid 1px var(--accentAlphaMiddle);
}

.xTicks {
	position: absolute;
	z-index: 1000;
	top: 0;
	left: 0;
	width: 100%;
	height: var(--xTicksHeight);
	background: #181818aa;
	backdrop-filter: blur(24px);
	overflow: clip;
	contain: content;
}
.xTick {
	position: absolute;
	top: 0;
	height: 100%;
	line-height: var(--xTicksHeight);
	font-size: 12px;
	padding: 0 0 0 8px;
	border-left: solid 1px #fff3;
}

.xTickActive {
	border-left: solid 1px var(--accentAlphaMiddle);
}

.ticksCorner {
	position: absolute;
	z-index: 1000;
	top: 0;
	left: 0;
	width: var(--yTicksWidth);
	height: var(--xTicksHeight);
	background: #181818;
}

.tl {
	position: relative;
	flex: 1;
	overflow: clip;
	background-size: auto auto;
	background-color: #2d2d2d;
	background-image: repeating-linear-gradient(45deg, transparent, transparent 6px, #222222 6px, #222222 12px );
	contain: content;

	&:focus {
		outline: none;
		//outline: solid 7px #fff;
	}
}

.lines {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	color: var(--THEME-accent);
}

.inTlXTick {
	position: absolute;
	top: 0;
	height: 100%;
	border-left: dotted 1px #fff1;
	pointer-events: none;
}
.inTlXTickZero {
	border-left: solid 1px #fff2;
}
.inTlXTickActive {
	border-left: solid 1px var(--accentAlphaMiddle);
}

.inTlYTick {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	border-top: dotted 1px #fff1;
	pointer-events: none;
}
.inTlYTickZero {
	border-top: solid 1px #fff2;
}
.inTlYTickActive {
	border-top: solid 1px var(--accentAlphaMiddle);
}

.xTicksSeekBar {
	position: absolute;
	top: 0;
	height: 100%;
	width: 3px;
	background: #FF5500;
	cursor: ew-resize;
	will-change: left;

	&::before {
		content: "";
		display: block;
		position: absolute;
		top: 0;
		left: -7px;
    width: 16px;
		height: 100%;
	}
}

.seekBar {
	position: absolute;
	top: var(--xTicksHeight);
	height: calc(100% - var(--xTicksHeight));
	width: 1px;
	background: #FF5500;
	pointer-events: none;
	will-change: left;

	&::before {
		content: "";
		display: block;
		position: absolute;
		top: 0;
		right: 0;
		width: 32px;
		height: 100%;
		background: linear-gradient(270deg, #FF550055, #FF550000);
	}
}
.seekBarFrame {
	display: inline-block;
	background: #FF5500;
	color: #fff;
	min-width: 40px;
}

.valueBar {
	position: absolute;
	left: var(--yTicksWidth);
	width: calc(100% - var(--yTicksWidth));
	height: 1px;
	background: #FF5500;
	pointer-events: none;
	will-change: top;
}
.valueBarValue {
	display: inline-block;
	background: #FF5500;
	color: #fff;
	min-width: 40px;
}

.crossPoint {
	position: absolute;
	z-index: 10;
	width: 9px;
	height: 9px;
	margin-left: -4px;
	margin-top: -4px;
	border-radius: 100%;
	background: #FF5500;
	pointer-events: none;
	will-change: top, left;
}

.cursorBar {
	position: absolute;
	top: 0;
	height: 100%;
	width: 1px;
	background: #fff1;
}

.automationGraph {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
}

@keyframes blink {
	0% { opacity: 1; transform: scale(1); }
	30% { opacity: 1; transform: scale(1); }
	90% { opacity: 0; transform: scale(0.5); }
}

.point {
	position: absolute;
	z-index: 1;
	cursor: pointer;
	display: block;
	position: absolute;
	margin-top: -7px;
	margin-left: -7px;
	width: 14px;
	height: 14px;
	background: transparent;
	border-radius: 100%;

	&::before {
		content: "";
		display: block;
		position: absolute;
		top: 2px;
		left: 2px;
		width: 11px;
		height: 11px;
		background: var(--THEME-accent);
		border-radius: 100%;
		pointer-events: none;
	}

	&.selectedPoint {
		&::before {
			background: #fff;
		}

		&::after {
			content: "";
			display: block;
			position: absolute;
			top: 2px;
			left: 2px;
			width: 10px;
			height: 10px;
			background: transparent;
			border-radius: 100%;
			outline: solid 1px var(--accentAlphaMiddle);
			outline-offset: 4px;
			animation: blink 1s infinite;
			pointer-events: none;
		}
	}
}

.tlRange {
	position: absolute;
	top: 0;
	background: #222;
	height: 100%;
}

.selectedArea {
	position: absolute;
	background: #fff1;
}

.tooltip {
	position: absolute;
	background: #0005;
	color: #fff;
	padding: 6px 10px;
	pointer-events: none;
}

.pointTooltip {
	position: absolute;
	left: 0;
	bottom: 100%;
	box-sizing: border-box;
	width: max-content;
	background: #0005;
	color: #fff;
	padding: 6px 10px;
	font-size: 85%;
	pointer-events: none;
}

.pointContextmenu {
	position: absolute;
	background: #0005;
	color: #fff;
	font-size: 13px;

	> div {
		display: flex;
		line-height: 24px;

		&:not(:first-child) {
			border-top: solid 1px #fff2;
		}
	}
}

.pointContextmenuHandle {
	width: 24px;
	height: 24px;
	text-align: center;
}

.pointContextmenuInput {
	padding: 0 4px;
}

.bezierHandle {
	position: absolute;
	cursor: move;
	margin-top: -10px;
	margin-left: -10px;
	width: 20px;
	height: 20px;
	border-radius: 100%;

	&::before {
		content: "";
		display: block;
		position: absolute;
		top: 5px;
		left: 5px;
		width: 10px;
		height: 10px;
		background: var(--THEME-accentSecondary);
		border-radius: 100%;
		pointer-events: none;
	}
}

.bezierSnapLineX {
	position: absolute;
	top: 0;
	width: 1px;
	height: 100%;
	background: var(--accentAlphaLow);
	pointer-events: none;

	&.bezierSnapLineXActive {
		background: var(--accentAlphaMiddle);
	}
}

.bezierSnapLineY {
	position: absolute;
	height: 1px;
	background: var(--accentAlphaLow);
	pointer-events: none;

	&.bezierSnapLineYActive {
		background: var(--accentAlphaMiddle);
	}
}

.infoBar {
	display: flex;
	position: absolute;
	bottom: 0;
	left: var(--yTicksWidth);
	box-sizing: border-box;
	padding: 0 8px;
	width: calc(100% - var(--yTicksWidth));
	height: 22px;
	line-height: 22px;
	font-size: 13px;
	background: #0008;
	color: #fff;
	overflow: clip;
	contain: strict;
	pointer-events: none;

	> div { // TODO: ちゃんとクラス指定する
		flex: 1;

		> b {
			margin-right: 1em;
			font-weight: normal;
			opacity: 0.7;

			&:after {
				content: ':';
			}
		}
	}
}

.rightSidePanel {
	position: absolute;
	top: 0;
	right: 0;
	box-sizing: border-box;
	padding: 18px;
	width: 300px;
	height: 100%;
	background: #0008;
	backdrop-filter: blur(4px);
	color: #fff;
}
</style>
