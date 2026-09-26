<template>
<div :class="$style.root">
	<div :class="$style.header">
		<GsButton @click="addLayer">addLayer</GsButton>
		<GsButton v-if="timeline.isTimelinePlaying.value" primary @click="pause"><i class="ti ti-player-pause"></i></GsButton>
		<GsButton v-else primary @click="play"><i class="ti ti-player-play"></i></GsButton>
	</div>
	<div :class="$style.body">
		<div :class="$style.tlBgWrapper">
			<div :class="$style.tlBgSideSpacer"></div>
			<div ref="tlEl" :class="$style.tlBg" tabindex="-1" @wheel="onTlWheel" @mousemove="onTlMousemove" @mousedown="onTlMousedown" @keydown="onTlKeydown">
				<div :class="$style.ticksCorner"></div>
				<div :class="$style.tlRange" :style="{ width: tlRangeElWidth + 'px', left: tlRangeElPosX + 'px' }"></div>
				<div v-for="time of xTicks" :class="[$style.inTlXTick]" :style="{ left: timeToDomX(time) + 'px' }"></div>
			</div>
		</div>
		<div :class="$style.layers">
			<div :class="$style.layersHeader">
				header
			</div>
			<XLayer
				v-for="layer of appContext.state.timeline.value"
				:key="layer.id"
				:layer="layer"
				:tlElWidth="tlElWidth"
				:tlPosX="tlPosX"
				:tlRangeX="tlRangeX"
				:snapTimes="xTicksWithHalf"
				:currentTime="time"
				:selectedKeyframe="selectedKeyframeSelection"
				:class="$style.layersLane"
				@selected="onLayerSelected(layer)"
				@keyframeSelected="onKeyframeSelected"
			/>
		</div>
		<div :class="$style.tlOverlayWrapper">
			<div :class="$style.tlOverlaySideSpacer"></div>
			<div :class="$style.tlOverlay">
				<div :class="$style.xTicks" @wheel="onXTicksWheel">
					<div v-for="time of xTicks" :class="$style.xTick" class="_monospace" :style="{ left: timeToDomX(time) + 'px' }">{{ formatMsToTimecode(time) }}</div>
					<div :class="$style.xTicksSeekBar" :style="{ left: (seekBarPos - 1) + 'px' }" @mousedown="onSeekBarMousedown"></div>
				</div>
				<div :class="$style.ticksCorner"></div>
				<div :class="$style.selectedArea" :style="{ width: selectedAreaElWidth + 'px', height: selectedAreaElHeight + 'px', bottom: selectedAreaElPosY + 'px', left: selectedAreaElPosX + 'px' }"></div>
				<div v-for="time of xTicks" :class="[$style.inTlXTick]" :style="{ left: timeToDomX(time) + 'px' }"></div>
				<div :class="$style.seekBar" class="_monospace" :style="{ left: seekBarPos + 'px' }"><div :class="$style.seekBarFrame">{{ formatMsToTimecode(time) }}</div></div>
				<div :class="$style.cursorBar" :style="{ left: cursorBarPos + 'px' }"></div>

				<!--
			<div v-if="(nowSelecting || selectedKeyframes.length === 0) && tooltipDomPos" :class="$style.tooltip" class="_monospace" :style="{ left: tooltipDomPos[0] + 'px', top: tooltipDomPos[1] + 'px' }">
				<div>T: {{ formatMsToTimecode(cursorTime) }}</div>
				<div>V: {{ cursorValue }}</div>
			</div>
			-->

				<div :class="$style.infoBar" class="_monospace">
					<div><b>TL Offset</b>{{ tlPosX.toFixed(2) }}, {{ tlPosY.toFixed(2) }}</div>
					<div><b>Cursor</b>{{ cursorTime }}, {{ cursorValue }}</div>
				</div>
			</div>
		</div>

		<div v-if="selectedKeyframe != null" :class="$style.rightSidePanel">
			<div :key="keyframeEditorKey" :class="$style.keyframeEditor">
				<GsButton small @click="selectedKeyframeSelection = null">Back to layer</GsButton>
				<div>{{ selectedKeyframe.def.ui.label }} · Keyframe</div>
				<GsInput small type="number" :min="selectedKeyframe.minX" :max="selectedKeyframe.maxX" :modelValue="selectedKeyframe.keyframe.x" @update:modelValue="updateKeyframeTime">
					<template #label>Time (ms)</template>
				</GsInput>
				<div>Value</div>
				<GsLiteralLeafValueControl
					:dataType="selectedKeyframe.binding.keyframesTimeline.dataType"
					:control="selectedKeyframe.def.ui.control"
					:value="selectedKeyframe.binding.keyframesTimeline.dataType.kind === 'scalar' ? selectedKeyframe.keyframe.value[0] : selectedKeyframe.keyframe.value.slice(0, selectedKeyframe.binding.keyframesTimeline.dataType.kind === 'vector' ? 2 : 4)"
					:title="selectedKeyframe.def.ui.label"
					@input="value => updateKeyframeValue(value)"
					@beginChanging="keyframeValueMergeKey = genId()"
					@changeContinuous="value => updateKeyframeValue(value, keyframeValueMergeKey)"
					@changeFinished="keyframeValueMergeKey = null"
					@reset="updateKeyframeValue(selectedKeyframe.def.defaultValue.value)"
				/>
				<GsSelect small :modelValue="selectedKeyframe.keyframe.interpolation.type" :items="[{ label: 'Hold', value: 'hold' }, { label: 'Linear', value: 'linear' }]" @update:modelValue="type => updateSelectedKeyframe({ interpolation: { type } })">
					<template #label>Interpolation to next keyframe</template>
				</GsSelect>
			</div>
		</div>
		<div v-else-if="selectedLayer != null" :class="$style.rightSidePanel">
			<div>{{ appContext.getVisualModuleById(selectedLayer?.visualModuleId)?.name }}</div>
			<div>Compositing</div>
			<GsVisualParam
				v-for="(paramDef, paramId) in timelineCompositingParamDefs"
				:key="`${selectedLayer.id}:compositing:${paramId}`"
				:availableVariables="layerEnvVarDefs"
				:automationGraphs="selectedLayer.automationGraphs"
				:visualModuleId="selectedLayer.visualModuleId"
				:paramPath="[paramId]"
				:paramDef="paramDef"
				:paramValue="selectedLayer.compositingParamValues[paramId]"
				@edit="event => onVisualModuleLayerParamEdit(event, 'compositing')"
			/>
			<div>Module parameters</div>
			<!-- TODO: struct / array / anyのカスタムパラメータ編集UI。型定義では許可するが、子の編集や配列操作は未対応。 -->
			<template
				v-for="paramDef of appContext.getVisualModuleById(selectedLayer.visualModuleId)!.paramDefs.filter(paramDef => !paramDef.isPrimaryInput)"
				:key="`${selectedLayer.id}:${paramDef.id}`"
			>
				<div v-if="paramDef.dataType.kind === 'struct' || paramDef.dataType.kind === 'array' || isParameterType(paramDef, 'any')">{{ paramDef.ui.label }}: Editing is not yet supported.</div>
				<GsVisualParam
					v-else
					:availableVariables="layerEnvVarDefs"
					:automationGraphs="selectedLayer.automationGraphs"
					:visualModuleId="selectedLayer.visualModuleId"
					:paramPath="[paramDef.id]"
					:paramDef="{ ...paramDef, canNode: false }"
					:paramValue="selectedLayer.paramValues[paramDef.id] ?? paramDef.defaultValue"
					@edit="event => onVisualModuleLayerParamEdit(event, 'module')"
				/>
			</template>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { isParameterType } from '@glitch/shared/parameter.ts';
import { visualModuleCustomParameterId } from '@glitch/shared/visual-module/types.ts';
import { layerEnvVarDefs } from '@glitch/shared/expression.ts';
import { computed, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { insertIntermediateNumbers, nearlyEqual, niceScale } from '@glitch/shared/utility/misc.js';
import { genId } from '@glitch/shared/utility/id.js';
import { timelineCompositingParamDefs } from '@glitch/shared/timeline/timeline-compositing.ts';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import XLayer from './GsTimeline.Layer.vue';
import GsLiteralLeafValueControl from './GsLiteralLeafValueControl.vue';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import GsButton from './common/GsButton.vue';
import GsVisualParam from './GsVisualParam.vue';
import type { Timeline } from '@glitch/shared/timeline/types.ts';
import type { ParameterBinding, KeyframesTimelineKeyframe } from '@glitch/shared/types.ts';
import type { TimelineKeyframeSelection } from './GsTimeline.Layer.vue';
import type { ParamEdit } from './GsVisualParam.vue';
import { appContext } from '@/app.ts';
import { dragListen } from '@/utility/drag.ts';
import * as timeline from '@/timeline.ts';

const X_TICKS_HEIGHT = 20;
const Y_TICKS_WIDTH = 0;

const duration = computed(() => {
	return appContext.state.timeline.value.reduce((max, layer) => Math.max(max, layer.endTimeMs), 0) ?? 0;
});
const time = timeline.currentTimelineTime;

const tlEl = useTemplateRef('tlEl');
const tlElWidth = ref(0);
const tlElHeight = ref(0);
const tlRangeX = ref(30000);
const tlRangeY = ref(5);
const tlPosX = ref(-3000);
const tlPosY = ref(-2.5);
const snappingY = ref<number | null>(null);
const seekBarPos = computed(() => {
	return timeToDomX(time.value);
});
const cursorBarPos = ref(0);
const tlRangeElPosX = computed(() => {
	return -((tlPosX.value / tlRangeX.value) * tlElWidth.value);
});
const tlRangeElWidth = computed(() => {
	return (duration.value / tlRangeX.value) * tlElWidth.value;
});
const tooltipDomPos = ref<null | [number, number]>(null);
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

const layerRects = computed(() => {
	const obj: Record<string, { left: number; width: number }> = {};
	for (const layer of appContext.state.timeline.value) {
		const left = timeToDomX(layer.startTimeMs);
		const width = timeToDomX(layer.endTimeMs) - left;
		obj[layer.id] = { left, width };
	}
	return obj;
});

const selectedLayerId = ref<string | null>(null);
const selectedLayer = computed(() => appContext.state.timeline.value.find(layer => layer.id === selectedLayerId.value) ?? null);
const selectedKeyframeSelection = ref<TimelineKeyframeSelection | null>(null);
const keyframeValueMergeKey = ref<string | null>(null);
const keyframeEditorKey = computed(() => JSON.stringify(selectedKeyframeSelection.value));
const selectedKeyframe = computed(() => {
	const selection = selectedKeyframeSelection.value;
	if (selection == null) return null;
	const layer = appContext.state.timeline.value.find(entry => entry.id === selection.layerId);
	if (layer == null) return null;
	const values: Partial<Record<string, ParameterBinding>> = selection.target === 'compositing' ? layer.compositingParamValues : layer.paramValues;
	const binding = values[selection.paramId];
	if (binding?.inputSource !== 'keyframesTimelineInline') return null;
	const def = selection.target === 'compositing'
		? Object.entries(timelineCompositingParamDefs).find(([id]) => id === selection.paramId)?.[1]
		: appContext.getVisualModuleById(layer.visualModuleId)?.paramDefs.find(entry => entry.id === selection.paramId);
	if (def == null || !(isParameterType(def, 'scalar') || isParameterType(def, 'vector') || isParameterType(def, 'color')) || def.dataType.kind !== binding.keyframesTimeline.dataType.kind) return null;
	const keyframes = binding.keyframesTimeline.keyframes.toSorted((a, b) => a.x - b.x);
	const index = keyframes.findIndex(entry => entry.id === selection.keyframeId);
	if (index < 0) return null;
	return {
		selection, binding, def, keyframe: keyframes[index],
		minX: Math.max(0, keyframes[index - 1]?.x ?? -Infinity),
		maxX: keyframes[index + 1]?.x ?? Infinity,
	};
});

watch(selectedKeyframeSelection, () => { keyframeValueMergeKey.value = null; });
watch(selectedKeyframe, value => {
	if (value == null) selectedKeyframeSelection.value = null;
});

function onKeyframeSelected(selection: TimelineKeyframeSelection) {
	selectedLayerId.value = selection.layerId;
	selectedKeyframeSelection.value = selection;
}

function updateSelectedKeyframe(patch: Partial<Pick<KeyframesTimelineKeyframe, 'x' | 'value' | 'interpolation'>>, mergeKey?: string | null) {
	const selected = selectedKeyframe.value;
	if (selected == null) return;
	if (Object.entries(patch).every(([key, value]) => JSON.stringify(selected.keyframe[key as keyof KeyframesTimelineKeyframe]) === JSON.stringify(value))) return;
	const value = deepClone(selected.binding);
	const keyframe = value.keyframesTimeline.keyframes.find(entry => entry.id === selected.selection.keyframeId);
	if (keyframe == null) return;
	Object.assign(keyframe, deepClone(patch));
	appContext.commit('editVisualModuleLayerParam', {
		layerId: selected.selection.layerId, target: selected.selection.target,
		paramId: visualModuleCustomParameterId(selected.selection.paramId),
		edit: { kind: 'keyframesTimelineInline', value },
	}, mergeKey);
}

function updateKeyframeValue(value: unknown, mergeKey?: string | null) {
	const selected = selectedKeyframe.value;
	if (selected == null) return;
	const kind = selected.binding.keyframesTimeline.dataType.kind;
	if (typeof value !== 'number' && !Array.isArray(value)) return;
	const components = typeof value === 'number' ? [value] : [...value];
	if (components.length !== (kind === 'scalar' ? 1 : kind === 'vector' ? 2 : 4) || !components.every(Number.isFinite)) return;
	updateSelectedKeyframe({ value: components }, mergeKey);
}

function updateKeyframeTime(value: string | number) {
	const selected = selectedKeyframe.value;
	const x = Number(value);
	if (selected == null || !Number.isFinite(x)) return;
	updateSelectedKeyframe({ x: Math.max(selected.minX, Math.min(selected.maxX, x)) });
}

// TODO: TLの表示DOMサイズに応じて変更
const xTicksCount = ref(15);
const xTicks = computed(() => niceScale(tlPosX.value, tlPosX.value + tlRangeX.value, xTicksCount.value));
const xTicksWithHalf = computed(() => insertIntermediateNumbers(xTicks.value));
const yTicksCount = ref(6);
const yTicks = computed(() => niceScale(tlPosY.value, tlPosY.value + tlRangeY.value, yTicksCount.value));
const yTicksWithHalf = computed(() => insertIntermediateNumbers(yTicks.value));

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

function onTlMousemove(ev: MouseEvent) {
	if (tlEl.value == null) return;
	const rect = tlEl.value.getBoundingClientRect();
	const mouseX = ev.clientX - rect.left;
	const mouseY = ev.clientY - rect.top;
	const time = domXToTime(mouseX);
	cursorBarPos.value = timeToDomX(time);

	cursorTime.value = time;
	tooltipDomPos.value = [mouseX + 10, mouseY + 10];
}

function onTlWheel(ev: WheelEvent) {
	if (tlEl.value == null) return;
	ev.preventDefault();

	const rect = tlEl.value.getBoundingClientRect();
	const x = ev.clientX - rect.left;
	const y = ev.clientY - rect.top;
	const anchorTime = domXToLogicalX(x) + tlPosX.value;
	const anchorValue = domYToValue(y);

	tlRangeX.value *= 1 + (ev.deltaY / 1000);
	tlRangeY.value *= 1 + (ev.deltaY / 1000);

	// 拡大・縮小前にカーソル直下にあった時刻・値が、同じ画面位置に留まるように補正する。
	tlPosX.value = anchorTime - domXToLogicalX(x);
	tlPosY.value = anchorValue - domYToLogicalY(y);
}

function onXTicksWheel(ev: WheelEvent) {
	if (tlEl.value == null) return;
	ev.preventDefault();
	ev.stopPropagation();

	const rect = tlEl.value.getBoundingClientRect();
	const x = ev.clientX - rect.left;
	const anchorTime = domXToLogicalX(x) + tlPosX.value;

	tlRangeX.value *= 1 + (ev.deltaY / 1000);
	tlPosX.value = anchorTime - domXToLogicalX(x);
}

let beforeClickedAt = 0;

function onTlMousedown(ev: MouseEvent) {
	if (tlEl.value == null) return;
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
		//onTlDblclick(ev);
		return;
	}

	beforeClickedAt = Date.now();

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

function onSeekBarMousedown(ev: MouseEvent) {
	if (tlEl.value == null) return;
	ev.stopPropagation();
	const position = tlEl.value.getBoundingClientRect();

	function move(x: number, y: number) {
		time.value = Math.min(duration.value - 1, Math.max(0, domXToTime(x)));
	}

	dragListen(me => {
		move(me.clientX - position.left, me.clientY - position.top);
	});
}

let copyingKeyframes = null;

function onTlKeydown(ev: KeyboardEvent) {
	console.log(ev.key, ev.ctrlKey);
	if (ev.key === 'Backspace') {
	} else if (ev.ctrlKey && ev.key === 'c') {
	} else if (ev.ctrlKey && ev.key === 'v') {
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
		return `${minutes}:${seconds.toString().padStart(2, '0')}.${Math.floor(milliseconds).toString().replace(/0+$/, '')}`;
	}
}

function onLayerSelected(layer: Timeline[number]) {
	selectedLayerId.value = layer.id;
	selectedKeyframeSelection.value = null;
}

function onVisualModuleLayerParamEdit(event: ParamEdit, target: 'module' | 'compositing') {
	const layer = selectedLayer.value;
	// TODO: struct / arrayの子の編集・要素操作。現在のカスタムパラメータ編集UIは末端の型だけを扱う。
	if (layer == null || event.paramPath.length !== 1) return;
	if (event.kind === 'node' || event.kind === 'externalCustomParameterInput' || event.kind === 'addElement' || event.kind === 'removeElement') return;
	if (event.kind === 'inputSource' && (event.inputSource === 'node' || event.inputSource === 'externalCustomParameterInput')) return;
	appContext.commit('editVisualModuleLayerParam', {
		layerId: layer.id,
		target,
		paramId: visualModuleCustomParameterId(String(event.paramPath[0])),
		edit: event,
	}, event.mergeKey != null ? `${layer.id}:${target}:${event.paramPath[0]}:${event.mergeKey}` : undefined);
}

function addLayer() {
	// TODO
}

function play() {
	timeline.playTimeline();
}

function pause() {
	timeline.stopTimeline();
}

onMounted(() => {
	if (tlEl.value == null) return;
	tlElWidth.value = tlEl.value.offsetWidth;
	tlElHeight.value = tlEl.value.offsetHeight;

	const resizeObserver = new ResizeObserver(() => {
		if (tlEl.value == null) return;
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

	--sideWidth: 300px;
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
	position: relative;
	flex: 1;
	display: flex;
}

.layers {
	display: flex;
	flex-direction: column;
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	overflow: auto;
	scrollbar-gutter: stable;
	direction: rtl; /* スクロールバーを左に表示したいため */
}

.layersHeader {
	direction: ltr;
	height: 40px;
}

.layersLane {
	direction: ltr;
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
	pointer-events: auto;
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

.tlBgWrapper { /* tl自体はスクロールバーを表示しないが、layers側で表示するスクロールバーにより位置がずれるため、補正するためにこっちでもスクロールバーの幅だけは確保しておく */
	display: flex;
	flex-direction: row;
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	overflow: auto;
	scrollbar-gutter: stable;
	direction: rtl; /* スクロールバーを左に表示したいため */
	flex-direction: row-reverse;
}
.tlBgSideSpacer {
	box-sizing: border-box;
	width: var(--sideWidth);
}

.tlBg {
	height: 100%;
	flex: 1;
	overflow: clip;
	background-size: auto auto;
	background-color: #2d2d2d;
	background-image: repeating-linear-gradient(45deg, transparent, transparent 6px, #222222 6px, #222222 12px );
	contain: content;
	direction: ltr;

	&:focus {
		outline: none;
		//outline: solid 7px #fff;
	}
}

.tlOverlayWrapper { /* tl自体はスクロールバーを表示しないが、layers側で表示するスクロールバーにより位置がずれるため、補正するためにこっちでもスクロールバーの幅だけは確保しておく */
	display: flex;
	flex-direction: row;
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	overflow: auto;
	scrollbar-gutter: stable;
	direction: rtl; /* スクロールバーを左に表示したいため */
	flex-direction: row-reverse;
	pointer-events: none;
}
.tlOverlaySideSpacer {
	box-sizing: border-box;
	width: var(--sideWidth);
}

.tlOverlay {
	height: 100%;
	flex: 1;
	overflow: clip;
	contain: content;
	pointer-events: none;
	direction: ltr;

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
	min-width: 5em;
	corner-shape: bevel;
	border-radius: 0 0 6px 0;
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

		> code {
			display: inline-block;
			min-width: 4em;
		}
	}
}

.rightSidePanel {
	overflow-y: auto;
	position: absolute;
	top: 0;
	right: 0;
	box-sizing: border-box;
	width: 400px;
	height: 100%;
	background: #0008;
	backdrop-filter: blur(4px);
	color: #fff;
}

.keyframeEditor {
	display: grid;
	gap: 12px;
	padding: 16px;
}

</style>
