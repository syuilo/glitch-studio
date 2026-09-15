<template>
<div :class="$style.root">
	<div :class="$style.header">
		<GsButton v-if="playing" @click="stop"><i class="ti ti-player-pause"></i> Stop</GsButton>
		<GsButton v-else @click="play"><i class="ti ti-player-play"></i> Play</GsButton>
		<div :class="$style.frameCount">{{ time }}</div>
	</div>
	<div :class="$style.body">
		<div :class="$style.side">
			<GsButton @click="addAutomation">Add automation</GsButton>

			<GsButton v-for="automation of appContext.state.automations.value" :key="automation.id" :primary="selectedAutomation?.id === automation.id" @click="switchAutomation(automation)">{{ automation.name }}</GsButton>
		</div>
		<div ref="tlEl" :class="$style.tl" tabindex="-1" @wheel="onTlWheel" @mousemove="onTlMousemove" @mousedown="onTlMousedown" @keydown="onTlKeydown">
			<div :class="$style.yTicks" @wheel="onYTicksWheel">
				<div v-for="v of yTicks" class="_monospace" :class="[$style.yTick, { [$style.yTickActive]: snappingY != null && nearlyEqual(snappingY, v) }]" :style="{ top: valueToDomY(v) + 'px' }">{{ v.toFixed(2) }}</div>
			</div>
			<div :class="$style.xTicks" @wheel="onXTicksWheel">
				<div v-for="time of xTicks" :class="$style.xTick" class="_monospace" :style="{ left: timeToDomX(time) + 'px' }">{{ formatMsToTimecode(time) }}</div>
				<div :class="$style.xTicksSeekBar" :style="{ left: (seekBarPos - 1) + 'px' }" @mousedown="onSeekBarMousedown"></div>
			</div>
			<div :class="$style.ticksCorner"></div>
			<div :class="$style.tlRange" :style="{ width: tlRangeElWidth + 'px', left: tlRangeElPosX + 'px' }"></div>
			<div :class="$style.selectedArea" :style="{ width: selectedAreaElWidth + 'px', height: selectedAreaElHeight + 'px', bottom: selectedAreaElPosY + 'px', left: selectedAreaElPosX + 'px' }"></div>
			<div v-for="time of xTicks" :class="[$style.inTlXTick]" :style="{ left: timeToDomX(time) + 'px' }"></div>
			<div v-for="v of yTicks" :class="[$style.inTlYTick, { [$style.inTlYTickZero]: v.toFixed(2).replace('-', '') === '0.00', [$style.inTlYTickActive]: snappingY != null && nearlyEqual(snappingY, v) }]" :style="{ top: valueToDomY(v) + 'px' }"></div>
			<div :class="$style.seekBar" class="_monospace" :style="{ left: seekBarPos + 'px' }"><div :class="$style.seekBarFrame">{{ formatMsToTimecode(time) }}</div></div>
			<div :class="$style.valueBar" class="_monospace" :style="{ top: valueBarPos + 'px' }"><div :class="$style.valueBarValue">{{ currentValue.toFixed(2) }}</div></div>
			<div :class="$style.crossPoint" :style="{ left: seekBarPos + 'px', top: valueBarPos + 'px' }"></div>
			<div v-if="!bezierDragging" :class="$style.cursorBar" :style="{ left: cursorBarPos + 'px' }"></div>
			<div v-if="selectedAutomation" :class="$style.automation">
				<svg version="1.1" :viewBox="`0 0 ${tlElWidth} ${tlElHeight}`" :class="$style.lines">
					<defs>
						<linearGradient id="tlAutomationGradient" x1="0" x2="0" y1="0" y2="1">
							<stop offset="0%" stop-color="var(--accentAlphaMiddleLow)"/>
							<stop :offset="automationPathGradientCenter + '%'" stop-color="var(--accentAlphaVeryLow)"/>
							<stop offset="100%" stop-color="var(--accentAlphaMiddleLow)"/>
						</linearGradient>
					</defs>
					<path :d="automationSvgPath" style="stroke: currentColor; fill: url(#tlAutomationGradient); stroke-width: 2;"/>
				</svg>

				<svg v-if="!nowSelecting && selectedKeyframe" version="1.1" :viewBox="`0 0 ${tlElWidth} ${tlElHeight}`" :class="$style.lines">
					<line
						v-if="bezierHandleADomPos"
						:x1="timeToDomX(selectedKeyframe.timeMs)"
						:y1="valueToDomY(selectedKeyframe.value)"
						:x2="bezierHandleADomPos[0]"
						:y2="bezierHandleADomPos[1]"
						style="stroke: var(--THEME-accentSecondary); stroke-width: 1;"
					/>
					<line
						v-if="bezierHandleBDomPos"
						:x1="timeToDomX(selectedKeyframe.timeMs)"
						:y1="valueToDomY(selectedKeyframe.value)"
						:x2="bezierHandleBDomPos[0]"
						:y2="bezierHandleBDomPos[1]"
						style="stroke: var(--THEME-accentSecondary); stroke-width: 1;"
					/>
				</svg>

				<div
					v-for="keyframe of selectedAutomation.keyframes"
					:class="[$style.keyframe, { [$style.selectedKeyframe]: selectedKeyframes.includes(keyframe) }]"
					:style="{ left: timeToDomX(keyframe.timeMs) + 'px', top: valueToDomY(keyframe.value) + 'px' }"
					@mousedown="onKeyframeMousedown($event, keyframe)"
					@contextmenu="onKeyframeContextmenu($event, keyframe)"
				></div>
			</div>

			<div v-if="(nowSelecting || selectedKeyframes.length === 0) && tooltipDomPos" :class="$style.tooltip" class="_monospace" :style="{ left: tooltipDomPos[0] + 'px', top: tooltipDomPos[1] + 'px' }">
				<div>T: {{ formatMsToTimecode(cursorTime) }}</div>
				<div>V: {{ cursorValue }}</div>
			</div>

			<div v-if="!nowSelecting && contextmenuKeyframe" :class="$style.keyframeContextmenu" :style="{ left: keyframeContextmenuDomPos[0] + 'px', top: keyframeContextmenuDomPos[1] + 'px' }">
				<div>
					<div :class="$style.keyframeContextmenuHandle" style="cursor: ns-resize;" @mousedown="onKeyframeYHandleMousedown"><i class="ti ti-arrows-vertical"></i></div>
					<div :class="$style.keyframeContextmenuInput">V: {{ contextmenuKeyframe.value.toFixed(2) }}</div>
				</div>
				<div>
					<div :class="$style.keyframeContextmenuHandle" style="cursor: ew-resize;" @mousedown="onKeyframeXHandleMousedown"><i class="ti ti-arrows-horizontal"></i></div>
					<div :class="$style.keyframeContextmenuInput">F: {{ contextmenuKeyframe.timeMs }}</div>
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

			<div :class="$style.infoBar">
				<div><b>TL Offset</b><code>{{ tlPosX.toFixed(2) }}</code>, <code>{{ tlPosY.toFixed(2) }}</code></div>
				<div><b>Cursor</b><code>{{ cursorTime }}</code>, <code>{{ cursorValue }}</code></div>
				<div><b>Current</b><code>{{ time }}</code>, <code>{{ currentValue.toFixed(2) }}</code></div>
				<div><b>Min/Max</b><code>{{ minMaxValuesInTheAutomation.min.toFixed(2) }}</code>, <code>{{ minMaxValuesInTheAutomation.max.toFixed(2) }}</code></div>
				<div><b>Automation ID</b><code>{{ selectedAutomation ? selectedAutomation.id.toUpperCase() : '-' }}</code></div>
			</div>
		</div>
		<div v-if="selectedKeyframe" :class="$style.rightSidePanel">
			<div>Bezier</div>
			<GsButton :primary="!isBezierAZero" @click="toggleBezierA">A</GsButton>
			<GsButton :primary="!isBezierBZero" @click="toggleBezierB">B</GsButton>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { evalAutomationValue, insertIntermediateNumbers, nearlyEqual, niceScale } from '@glitch/shared/utility/misc.js';
import { genId } from '@glitch/shared/utility/id.js';
import GsButton from './common/GsButton.vue';
import type { GsAutomation, GsKeyframe } from '@glitch/shared/types.js';
import { playing, appContext } from '@/app.ts';
import { dragListen } from '@/utility/drag.ts';

const X_TICKS_HEIGHT = 20;
const Y_TICKS_WIDTH = 60;

// 最も長いtimeMsをもつkeyframeのtimeMs
const duration = computed(() => {
	return selectedAutomation.value?.keyframes.reduce((max, kf) => Math.max(max, kf.timeMs), 0) ?? 0;
});
const time = ref(0);

const tlEl = useTemplateRef('tlEl');
const tlElWidth = ref(0);
const tlElHeight = ref(0);
const tlRangeX = ref(30000);
const tlRangeY = ref(5);
const tlPosX = ref(-3000);
const tlPosY = ref(-2.5);
const snappingY = ref<number | null>(null);
const selectedAutomation = ref<GsAutomation | null>(null);
const selectedKeyframes = ref<GsKeyframe[]>([]);
const selectedKeyframe = computed(() => selectedKeyframes.value.length === 1 ? selectedKeyframes.value[0] : null);
const contextmenuKeyframe = ref<GsKeyframe | null>(null);
const seekBarPos = computed(() => {
	return timeToDomX(time.value);
});
const currentValue = computed(() => {
	return selectedAutomation.value ? evalAutomationValue(selectedAutomation.value, time.value) : 0;
});
const valueBarPos = computed(() => {
	return valueToDomY(currentValue.value);
});
const cursorBarPos = ref(0);
const tlRangeElPosX = computed(() => {
	return -((tlPosX.value / tlRangeX.value) * tlElWidth.value);
});
const tlRangeElWidth = computed(() => {
	return (duration.value / tlRangeX.value) * tlElWidth.value;
});
const tooltipDomPos = ref<null | [0, 0]>(null);
const keyframeContextmenuDomPos = computed(() => {
	if (!contextmenuKeyframe.value) return null;
	return [
		timeToDomX(contextmenuKeyframe.value.timeMs) + 5,
		valueToDomY(contextmenuKeyframe.value.value) + 5,
	];
});
const bezierHandleADomPos = computed(() => {
	if (!selectedKeyframe.value) return null;
	return [
		logicalXToDomX(selectedKeyframe.value.timeMs + selectedKeyframe.value.bezierControlPointA[0]),
		logicalYToDomY(selectedKeyframe.value.value + selectedKeyframe.value.bezierControlPointA[1]),
	];
});
const bezierHandleBDomPos = computed(() => {
	if (!selectedKeyframe.value) return null;
	return [
		logicalXToDomX(selectedKeyframe.value.timeMs + selectedKeyframe.value.bezierControlPointB[0]),
		logicalYToDomY(selectedKeyframe.value.value + selectedKeyframe.value.bezierControlPointB[1]),
	];
});
const isBezierAZero = computed(() => {
	if (!selectedKeyframe.value) return false;
	return selectedKeyframe.value.bezierControlPointA[0] === 0 && selectedKeyframe.value.bezierControlPointA[1] === 0;
});
const isBezierBZero = computed(() => {
	if (!selectedKeyframe.value) return false;
	return selectedKeyframe.value.bezierControlPointB[0] === 0 && selectedKeyframe.value.bezierControlPointB[1] === 0;
});
const cursorTime = ref(0);
const cursorValue = ref(0);
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
const xTicksCount = ref(15);
const xTicks = computed(() => niceScale(tlPosX.value, tlPosX.value + tlRangeX.value, xTicksCount.value));
const xTicksWithHalf = computed(() => insertIntermediateNumbers(xTicks.value));
const yTicksCount = ref(6);
const yTicks = computed(() => niceScale(tlPosY.value, tlPosY.value + tlRangeY.value, yTicksCount.value));
const yTicksWithHalf = computed(() => insertIntermediateNumbers(yTicks.value));

// TODO: もっと高速に計算する方法ないだろうか
const minMaxValuesInTheAutomation = computed(() => {
	if (!selectedAutomation.value) return { min: 0, max: 0 };
	let min = 0;
	let max = 0;
	for (let i = 0; i < duration.value; i++) {
		const fv = evalAutomationValue(selectedAutomation.value, i);
		if (fv < min) min = fv;
		if (fv > max) max = fv;
	}
	return {
		min,
		max,
	};
});

const automationSvgPath = computed(() => {
	if (!selectedAutomation.value) return '';
	const keyframes = selectedAutomation.value.keyframes;
	let d = `M ${timeToDomX(0)}, ${valueToDomY(0)} L ${timeToDomX(keyframes[0].timeMs)}, ${valueToDomY(keyframes[0].value)}`;
	for (let i = 0; i < keyframes.length - 1; i++) {
		const keyframe = keyframes[i];
		const dx1 = timeToDomX(Math.min(keyframes[i + 1].timeMs, keyframe.timeMs + (keyframe.bezierControlPointB[0])));
		const dy1 = valueToDomY(keyframe.value + (keyframe.bezierControlPointB[1]));
		const dx2 = timeToDomX(Math.max(keyframe.timeMs, keyframes[i + 1].timeMs + (keyframes[i + 1].bezierControlPointA[0])));
		const dy2 = valueToDomY(keyframes[i + 1].value + (keyframes[i + 1].bezierControlPointA[1]));
		const dx = timeToDomX(keyframes[i + 1].timeMs);
		const dy = valueToDomY(keyframes[i + 1].value);
		d += ` C ${dx1}, ${dy1} ${dx2}, ${dy2} ${dx}, ${dy}`;
	}
	d += ` L ${timeToDomX(keyframes[keyframes.length - 1].timeMs)}, ${valueToDomY(0)}`;
	return d;
});
const automationPathGradientCenter = computed(() => {
	if (!selectedAutomation.value) return 0;
	const max = minMaxValuesInTheAutomation.value.max;
	const min = Math.min(0, minMaxValuesInTheAutomation.value.min);
	if (max === 0 && min === 0) return 0;
	return ((max) / (max + Math.abs(min))) * 100;
});

function timeToDomX(time: number): number {
	return ((time - tlPosX.value) / tlRangeX.value) * tlElWidth.value;
}

function valueToDomY(value: number): number {
	return tlElHeight.value - (((value - tlPosY.value) / tlRangeY.value) * tlElHeight.value);
}

function logicalXToDomX(x: number): number {
	return timeToDomX(x);
}

function logicalYToDomY(y: number): number {
	return valueToDomY(y);
}

function domXToLogicalX(x: number): number {
	return ((x / tlElWidth.value) * tlRangeX.value);
}

function domXToTime(x: number): number {
	return Math.round(domXToLogicalX(x) + tlPosX.value);
}

function domYToLogicalY(y: number): number {
	return ((1 - (y / tlElHeight.value)) * tlRangeY.value);
}

function domYToValue(y: number): number {
	return domYToLogicalY(y) + tlPosY.value;
}

function play() {
	playing.value = true;
}

function stop() {
	playing.value = false;
}

function addAutomation() {
	const id = genId();
	const automation: GsAutomation = {
		id: id,
		name: 'kf_' + id,
		keyframes: [{
			id: genId(),
			timeMs: 0,
			value: 0,
			bezierControlPointA: [0, 0],
			bezierControlPointB: [1000, 0],
		}, {
			id: genId(),
			timeMs: 1000 * 10,
			value: 1,
			bezierControlPointA: [-1000, 0],
			bezierControlPointB: [0, 0],
		}],
	};
	appContext.state.automations.value.push(automation);
	selectedAutomation.value = automation;
}

function switchAutomation(automation: GsAutomation) {
	selectedAutomation.value = automation;
}

function addKeyframe(time: number, value: number): GsKeyframe {
	if (selectedAutomation.value == null) throw new Error('no selected automation');
	const keyframes = [] as GsKeyframe[];
	const keyframe: GsKeyframe = {
		id: genId(),
		timeMs: time,
		value,
		bezierControlPointA: [-1000, 0],
		bezierControlPointB: [1000, 0],
	};
	let pushed = false;
	if (selectedAutomation.value.keyframes.filter(kf => kf.timeMs === time).length > 1) return;
	for (const kf of selectedAutomation.value.keyframes) {
		if (!pushed && kf.timeMs > time) {
			keyframes.push(keyframe);
			keyframes.push(kf);
			pushed = true;
		} else {
			keyframes.push(kf);
		}
	}
	if (!pushed) {
		keyframes.push(keyframe);
	}
	selectedAutomation.value.keyframes = keyframes;
	return keyframe;
}

function onTlMousemove(ev: MouseEvent) {
	const rect = tlEl.value.getBoundingClientRect();
	const mouseX = ev.clientX - rect.left;
	const mouseY = ev.clientY - rect.top;
	const time = domXToTime(mouseX);
	cursorBarPos.value = timeToDomX(time);

	const value = domYToValue(mouseY);
	cursorValue.value = value.toFixed(2);
	cursorTime.value = time;
	tooltipDomPos.value = [mouseX + 10, mouseY + 10];
}

function onTlWheel(ev: WheelEvent) {
	ev.preventDefault();

	tlRangeX.value *= 1 + (ev.deltaY / 1000);
	tlRangeY.value *= 1 + (ev.deltaY / 1000);

	const rect = tlEl.value.getBoundingClientRect();
	const x = ((ev.clientX - rect.left) * 2) - (tlElWidth.value / 2);
	const y = ((ev.clientY - rect.top) * 2) - (tlElHeight.value / 2);
	tlPosX.value = domXToLogicalX(x) - ((domXToLogicalX(x) - tlPosX.value) * (1 + (ev.deltaY / 1000)));
	tlPosY.value = domYToLogicalY(y) - ((domYToLogicalY(y) - tlPosY.value) * (1 + (ev.deltaY / 1000)));
}

function onXTicksWheel(ev: WheelEvent) {
	ev.preventDefault();
	ev.stopPropagation();

	tlRangeX.value *= 1 + (ev.deltaY / 1000);

	const rect = tlEl.value.getBoundingClientRect();
	const x = ((ev.clientX - rect.left) * 2) - (tlElWidth.value / 2);
	tlPosX.value = domXToLogicalX(x) - ((domXToLogicalX(x) - tlPosX.value) * (1 + (ev.deltaY / 1000)));
}

function onYTicksWheel(ev: WheelEvent) {
	ev.preventDefault();
	ev.stopPropagation();

	tlRangeY.value *= 1 + (ev.deltaY / 1000);

	const rect = tlEl.value.getBoundingClientRect();
	const y = ((ev.clientY - rect.top) * 2) - (tlElHeight.value / 2);
	tlPosY.value = domYToLogicalY(y) - ((domYToLogicalY(y) - tlPosY.value) * (1 + (ev.deltaY / 1000)));
}

function onTlDblclick(ev: MouseEvent) {
	if (ev.button === 1) return;
	if (selectedAutomation.value == null) return;

	const rect = tlEl.value.getBoundingClientRect();
	const clickX = ev.clientX - rect.left;
	const clickY = ev.clientY - rect.top;
	const time = domXToTime(clickX);
	let value = domYToValue(clickY);

	// snap
	for (const step of [...yTicksWithHalf.value, 1]) { // 1は重要なのでどんな時でもスナップ候補
		const stepY = valueToDomY(step);
		if (clickY > stepY - SNAP_THRESHOLD && clickY < stepY + SNAP_THRESHOLD) {
			value = step;
			break;
		}
	}

	const keyframe = addKeyframe(time, value);

	selectedKeyframes.value = [keyframe];

	onKeyframeMousedown(ev, keyframe);
}

let beforeClickedAt = 0;

function onTlMousedown(ev: MouseEvent) {
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

	selectedKeyframes.value = [];
	contextmenuKeyframe.value = null;

	const position = tlEl.value.getBoundingClientRect();
	const moveBaseX = ev.clientX - position.left;
	const moveBaseY = ev.clientY - position.top;

	function move(x: number, y: number) {
		const originFrame = domXToTime(Math.min(moveBaseX, x));
		const targetFrame = domXToTime(Math.max(moveBaseX, x));
		const originValue = domYToValue(Math.max(moveBaseY, y));
		const targetValue = domYToValue(Math.min(moveBaseY, y));
		selectedAreaPosX.value = originFrame;
		selectedAreaPosY.value = originValue;
		selectedAreaWidth.value = targetFrame - originFrame;
		selectedAreaHeight.value = targetValue - originValue;

		if (selectedAutomation.value) {
			selectedKeyframes.value = selectedAutomation.value.keyframes.filter(kf =>
				kf.timeMs >= originFrame && kf.timeMs <= targetFrame && kf.value >= originValue && kf.value <= targetValue,
			);
		}
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

function onKeyframesXYHandleMousedown(ev: MouseEvent, keyframe: GsKeyframe, treatX: boolean, treatY: boolean) {
	ev.stopPropagation();
	const prevKeyframe = selectedAutomation.value?.keyframes[selectedAutomation.value.keyframes.indexOf(selectedKeyframes.value[0]) - 1];
	const nextKeyframe = selectedAutomation.value?.keyframes[selectedAutomation.value.keyframes.indexOf(selectedKeyframes.value[selectedKeyframes.value.length - 1]) + 1];
	const position = tlEl.value.getBoundingClientRect();
	const moveBaseX = ev.clientX - position.left;
	const moveBaseY = ev.clientY - position.top;
	const baseTime = keyframe.timeMs;
	const baseValue = keyframe.value;
	const baseFrames = selectedKeyframes.value.map(keyframe => keyframe.timeMs);
	const baseValues = selectedKeyframes.value.map(keyframe => keyframe.value);
	const firstFrameOffset = baseTime - baseFrames[0];
	const lastFrameOffset = baseTime - baseFrames[baseFrames.length - 1];

	function move(x: number, y: number) {
		const baseNewTime = treatX ? Math.max((prevKeyframe?.timeMs ?? -Infinity) + firstFrameOffset, Math.min((nextKeyframe?.timeMs ?? Infinity) + lastFrameOffset, baseTime + (domXToTime(x) - domXToTime(moveBaseX)))) : baseTime;
		let baseNewValue = treatY ? baseValue + (domYToValue(y) - domYToValue(moveBaseY)) : baseValue;

		if (treatY) {
			snappingY.value = null;
			// snap
			for (const step of [...yTicksWithHalf.value, prevKeyframe?.value ?? 1, nextKeyframe?.value ?? 1, 1]) { // 1は重要なのでどんな時でもスナップ候補
				const stepY = valueToDomY(step);
				if (valueToDomY(baseValue) + (y - moveBaseY) > stepY - SNAP_THRESHOLD && valueToDomY(baseValue) + (y - moveBaseY) < stepY + SNAP_THRESHOLD) {
					baseNewValue = step;
					snappingY.value = step;
					break;
				}
			}

			// TODO: 比率を維持して制御点を再スケール
			//keyframe.bezierControlPointA[1] = ?
			//keyframe.bezierControlPointB[1] = ?
		}

		for (let i = 0; i < selectedKeyframes.value.length; i++) {
			const keyframe = selectedKeyframes.value[i];
			if (treatX) keyframe.timeMs = Math.max(0, baseNewTime + (baseFrames[i] - baseTime));
			if (treatY) keyframe.value = baseNewValue + (baseValues[i] - baseValue);
		}
	}

	dragListen(me => {
		move(me.clientX - position.left, me.clientY - position.top);
	}, () => {
		snappingY.value = null;
	});
}

function onKeyframeXHandleMousedown(ev: MouseEvent) {
	ev.stopPropagation();
	onKeyframesXYHandleMousedown(ev, contextmenuKeyframe.value, true, false);
}

function onKeyframeYHandleMousedown(ev: MouseEvent) {
	ev.stopPropagation();
	onKeyframesXYHandleMousedown(ev, contextmenuKeyframe.value, false, true);
}

function onKeyframeMousedown(ev: MouseEvent, keyframe: GsKeyframe) {
	ev.stopPropagation();
	if (ev.button !== 0) return;

	if (selectedKeyframes.value.length === 0) {
		selectedKeyframes.value = [keyframe];
	} else if (!selectedKeyframes.value.includes(keyframe)) {
		selectedKeyframes.value = [keyframe];
	}

	onKeyframesXYHandleMousedown(ev, keyframe, true, true);
}

function onKeyframeContextmenu(ev: MouseEvent, keyframe: GsKeyframe) {
	ev.preventDefault();
	ev.stopPropagation();

	if (selectedKeyframes.value.length === 0) {
		selectedKeyframes.value = [keyframe];
	} else if (!selectedKeyframes.value.includes(keyframe)) {
		selectedKeyframes.value = [keyframe];
	}

	contextmenuKeyframe.value = keyframe;
}

const BEZIER_SNAP_THRESHOLD = 8;
const BEZIER_X_SNAP_STEPS = [0, 0.25, 0.5, 0.75, 1];
const BEZIER_Y_SNAP_STEPS = [-2, -1.5, -1, -0.5, 0, 0.5, 1];

function onBezierHandleAMousedown(ev: MouseEvent) {
	ev.stopPropagation();
	const keyframe = selectedAutomation.value.keyframes.find(kf => kf.id === selectedKeyframe.value.id)!;
	const prevKeyframe = selectedAutomation.value?.keyframes[selectedAutomation.value.keyframes.indexOf(selectedKeyframe.value) - 1];
	if (prevKeyframe == null) return;
	const position = tlEl.value.getBoundingClientRect();
	const moveBaseX = ev.clientX - position.left;
	const moveBaseY = ev.clientY - position.top;
	const baseTime = keyframe.timeMs;
	const baseValue = keyframe.value;
	const baseControlPointX = keyframe.bezierControlPointA[0];
	const baseControlPointY = keyframe.bezierControlPointA[1];

	bezierSnapLinesX.value = BEZIER_X_SNAP_STEPS.map(step => ({
		x: timeToDomX(keyframe.timeMs - ((keyframe.timeMs - prevKeyframe.timeMs) * step)),
	}));
	bezierSnapLinesY.value = BEZIER_Y_SNAP_STEPS.map(step => ({
		x: timeToDomX(prevKeyframe.timeMs),
		y: valueToDomY(keyframe.value - ((prevKeyframe.value - keyframe.value) * step)),
		width: timeToDomX(keyframe.timeMs) - timeToDomX(prevKeyframe.timeMs),
	}));

	function move(x: number, y: number) {
		keyframe.bezierControlPointA = [
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
		const domX = bezierHandleADomPos.value[0];
		for (let i = 0; i < BEZIER_X_SNAP_STEPS.length; i++) {
			const step = BEZIER_X_SNAP_STEPS[i];
			const stepX = timeToDomX(baseTime - ((baseTime - prevKeyframe.timeMs) * step));
			if (domX > stepX - BEZIER_SNAP_THRESHOLD && domX < stepX + BEZIER_SNAP_THRESHOLD) {
				keyframe.bezierControlPointA[0] = 0 - ((baseTime - prevKeyframe.timeMs) * step);
				bezierSnapLinesX.value[i].active = true;
				break;
			}
		}
		const domY = bezierHandleADomPos.value[1];
		for (let i = 0; i < BEZIER_Y_SNAP_STEPS.length; i++) {
			const step = BEZIER_Y_SNAP_STEPS[i];
			const stepY = valueToDomY(baseValue - ((prevKeyframe.value - baseValue) * step));
			if (domY > stepY - BEZIER_SNAP_THRESHOLD && domY < stepY + BEZIER_SNAP_THRESHOLD) {
				keyframe.bezierControlPointA[1] = (baseValue - prevKeyframe.value) * step;
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
	ev.stopPropagation();
	const keyframe = selectedAutomation.value.keyframes.find(kf => kf.id === selectedKeyframe.value.id)!;
	const nextKeyframe = selectedAutomation.value?.keyframes[selectedAutomation.value.keyframes.indexOf(selectedKeyframe.value) + 1];
	if (nextKeyframe == null) return;
	const position = tlEl.value.getBoundingClientRect();
	const moveBaseX = ev.clientX - position.left;
	const moveBaseY = ev.clientY - position.top;
	const baseTime = keyframe.timeMs;
	const baseValue = keyframe.value;
	const baseControlPointX = keyframe.bezierControlPointB[0];
	const baseControlPointY = keyframe.bezierControlPointB[1];

	bezierSnapLinesX.value = BEZIER_X_SNAP_STEPS.map(step => ({
		x: timeToDomX(keyframe.timeMs - ((keyframe.timeMs - nextKeyframe.timeMs) * step)),
	}));
	bezierSnapLinesY.value = BEZIER_Y_SNAP_STEPS.map(step => ({
		x: timeToDomX(keyframe.timeMs),
		y: valueToDomY(keyframe.value - ((nextKeyframe.value - keyframe.value) * step)),
		width: timeToDomX(nextKeyframe.timeMs) - timeToDomX(keyframe.timeMs),
	}));

	function move(x: number, y: number) {
		keyframe.bezierControlPointB = [
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
		const domX = bezierHandleBDomPos.value[0];
		for (let i = 0; i < BEZIER_X_SNAP_STEPS.length; i++) {
			const step = BEZIER_X_SNAP_STEPS[i];
			const stepX = timeToDomX(baseTime - ((baseTime - nextKeyframe.timeMs) * step));
			if (domX > stepX - BEZIER_SNAP_THRESHOLD && domX < stepX + BEZIER_SNAP_THRESHOLD) {
				keyframe.bezierControlPointB[0] = 0 - ((baseTime - nextKeyframe.timeMs) * step);
				bezierSnapLinesX.value[i].active = true;
				break;
			}
		}
		const domY = bezierHandleBDomPos.value[1];
		for (let i = 0; i < BEZIER_Y_SNAP_STEPS.length; i++) {
			const step = BEZIER_Y_SNAP_STEPS[i];
			const stepY = valueToDomY(baseValue - ((nextKeyframe.value - baseValue) * step));
			if (domY > stepY - BEZIER_SNAP_THRESHOLD && domY < stepY + BEZIER_SNAP_THRESHOLD) {
				keyframe.bezierControlPointB[1] = (baseValue - nextKeyframe.value) * step;
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
	ev.stopPropagation();
	const position = tlEl.value.getBoundingClientRect();

	function move(x: number, y: number) {
		time.value = domXToTime(x);
	}

	dragListen(me => {
		move(me.clientX - position.left, me.clientY - position.top);
	});
}

function deleteKeyframe(keyframe: GsKeyframe) {
	const automation = selectedAutomation.value;
	if (!automation) return;
	const index = automation.keyframes.indexOf(keyframe);
	if (index === -1) return;
	automation.keyframes.splice(index, 1);
}

let copyingKeyframes = null;

function onTlKeydown(ev: KeyboardEvent) {
	console.log(ev.key, ev.ctrlKey);
	if (ev.key === 'Backspace') {
		const kfs = selectedKeyframes.value;
		selectedKeyframes.value = [];
		contextmenuKeyframe.value = null;
		for (const kf of kfs) {
			deleteKeyframe(kf);
		}
	} else if (ev.ctrlKey && ev.key === 'c') {
		copyingKeyframes = JSON.parse(JSON.stringify(selectedKeyframes.value));
	} else if (ev.ctrlKey && ev.key === 'v') {
		if (copyingKeyframes == null) return;
		if (selectedAutomation.value == null) return;
		const baseTime = copyingKeyframes[0].timeMs;
		for (const kf of copyingKeyframes) {
			addKeyframe(cursorTime.value + (kf.frame - baseTime), kf.value);
		}
	}
}

function toggleBezierA() {
	if (selectedKeyframe.value == null) return;
	if (isBezierAZero.value) {
		selectedKeyframe.value.bezierControlPointA = [-1000, 0];
	} else {
		selectedKeyframe.value.bezierControlPointA = [0, 0];
	}
}

function toggleBezierB() {
	if (selectedKeyframe.value == null) return;
	if (isBezierBZero.value) {
		selectedKeyframe.value.bezierControlPointB = [1000, 0];
	} else {
		selectedKeyframe.value.bezierControlPointB = [0, 0];
	}
}

function formatMsToTimecode(ms: number) {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	const milliseconds = ms % 1000;
	if (milliseconds === 0) {
		return `${minutes}:${seconds.toString().padStart(2, '0')}`;
	} else {
		return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().replace(/0+$/, '')}`;
	}
}

onMounted(() => {
	tlElWidth.value = tlEl.value.offsetWidth;
	tlElHeight.value = tlEl.value.offsetHeight;

	const resizeObserver = new ResizeObserver(() => {
		tlElWidth.value = tlEl.value.offsetWidth;
		tlElHeight.value = tlEl.value.offsetHeight;
	});

	resizeObserver.observe(tlEl.value);
});
</script>

<style module lang="scss">
.root {
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
	height: 32px;
	line-height: 32px;
}
.frameCount {
	font-size: 18px;
}

.body {
	flex: 1;
	display: flex;
}

.side {
	box-sizing: border-box;
	width: 300px;
	padding: 16px;
	background: #181818;
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

.automation {
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

.keyframe {
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

	&.selectedKeyframe {
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
	font-size: 13px;
}

.keyframeContextmenu {
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

.keyframeContextmenuHandle {
	width: 24px;
	height: 24px;
	text-align: center;
}

.keyframeContextmenuInput {
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

	> div {
		flex: 1;

		> b {
			margin-right: 1em;
			font-weight: normal;
			opacity: 0.7;

			&:after {
				content: ':';
			}
		}

		> code {
			display: inline-block;
			min-width: 4em;
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
