<template>
<GsModal
	ref="modal"
	:zPriority="'high'"
	:anchorElement="anchorElement"
	:transparentBg="true"
	@click="modal?.close()"
	@closed="emit('closed')"
>
	<div :class="$style.root" class="_shadow _popup" tabindex="-1" @keydown.stop="onKeydown">
		<div
			ref="surface"
			:class="[$style.surface, {
				[$style.lockedX]: axisLock === 'x',
				[$style.lockedY]: axisLock === 'y',
			}]"
			tabindex="0"
			@keydown="onKeydown"
			@pointerdown="onPointerDown"
			@pointermove="onPointerMove"
			@pointerup="onPointerUp"
			@pointercancel="onPointerUp"
		>
			<div :class="$style.horizontalGuide" :style="{ top: yPosition }"></div>
			<div :class="$style.verticalGuide" :style="{ left: xPosition }"></div>
			<div :class="$style.point" :style="{ left: xPosition, top: yPosition }"></div>
		</div>
		<div :class="$style.side">
			<GsButton style="flex: 1; min-width: 0;" small :primary="axisLock === 'x'" @click="toggleAxisLock('x')"><i class="ti ti-arrows-horizontal"></i></GsButton>
			<GsButton style="flex: 1; min-width: 0;" small :primary="axisLock === 'y'" @click="toggleAxisLock('y')"><i class="ti ti-arrows-vertical"></i></GsButton>
			<GsButton style="flex: 1; min-width: 0;" small :primary="lockedRatio != null" @click="lockedRatio != null ? emit('disableRatioLock') : emit('enableRatioLock')"><i class="ti ti-link"></i></GsButton>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { computed, ref, useTemplateRef, watch } from 'vue';
import GsButton from './GsButton.vue';
import GsModal from './GsModal.vue';

const props = withDefaults(defineProps<{
	modelValue: [number, number];
	logarithmic?: boolean;
	min?: number;
	max: number;
	anchorElement: HTMLElement;
	lockedRatio: [number, number] | null;
}>(), {
	min: 0,
});

const emit = defineEmits<{
	(ev: 'update:modelValue', value: [number, number]): void;
	(ev: 'beginChanging'): void;
	(ev: 'changeFinished', value: [number, number]): void;
	(ev: 'enableRatioLock'): void;
	(ev: 'disableRatioLock'): void;
	(ev: 'closed'): void;
}>();

const modal = useTemplateRef('modal');

type AxisLock = 'x' | 'y' | null;

const surface = useTemplateRef<HTMLElement>('surface');
const value = ref<[number, number]>([...props.modelValue]);
const axisLock = ref<AxisLock>(null);
const activePointerId = ref<number | null>(null);

const useLogarithmic = computed(() => props.logarithmic && props.min > 0 && props.max > props.min);

const xPosition = computed(() => `${toRatio(value.value[0]) * 100}%`);
const yPosition = computed(() => `${(1 - toRatio(value.value[1])) * 100}%`);

watch(() => props.modelValue, (newValue) => {
	value.value = [...newValue];
}, { deep: true });

watch(() => props.lockedRatio, (newRatio) => {
	if (newRatio != null) {
		axisLock.value = null;
	}
});

function toRatio(number: number): number {
	if (props.max === props.min) return 0;
	if (useLogarithmic.value) {
		const clamped = Math.min(props.max, Math.max(props.min, number));
		return Math.log(clamped / props.min) / Math.log(props.max / props.min);
	}
	return Math.min(1, Math.max(0, (number - props.min) / (props.max - props.min)));
}

function fromRatio(ratio: number): number {
	const clamped = Math.min(1, Math.max(0, ratio));
	return useLogarithmic.value ? props.min * (props.max / props.min) ** clamped : props.min + clamped * (props.max - props.min);
}

function snap(number: number): number {
	const clamped = Math.min(props.max, Math.max(props.min, number));
	if (useLogarithmic.value) return clamped;
	if (props.step == null || props.step <= 0) return clamped;
	const snapped = props.min + Math.round((clamped - props.min) / props.step) * props.step;
	return Number(Math.min(props.max, Math.max(props.min, snapped)).toFixed(10));
}

function setValue(x: number, y: number, changedAxis?: 'x' | 'y') {
	value.value = [snap(x), snap(y)];
	emit('update:modelValue', value.value);
}

function updateFromPointer(event: PointerEvent) {
	if (surface.value == null) return;
	const bounds = surface.value.getBoundingClientRect();
	const x = fromRatio((event.clientX - bounds.left) / bounds.width);
	const y = fromRatio(1 - (event.clientY - bounds.top) / bounds.height);
	setValue(axisLock.value === 'y' ? value.value[0] : x, axisLock.value === 'x' ? value.value[1] : y);
}

function onPointerDown(event: PointerEvent) {
	if (event.button !== 0) return;
	emit('beginChanging');
	activePointerId.value = event.pointerId;
	surface.value?.setPointerCapture(event.pointerId);
	updateFromPointer(event);
}

function onPointerMove(event: PointerEvent) {
	if (activePointerId.value !== event.pointerId) return;
	updateFromPointer(event);
}

function onPointerUp(event: PointerEvent) {
	if (activePointerId.value !== event.pointerId) return;
	updateFromPointer(event);
	activePointerId.value = null;
	if (surface.value?.hasPointerCapture(event.pointerId)) surface.value.releasePointerCapture(event.pointerId);
	emit('changeFinished', value.value);
}

function onKeydown(event: KeyboardEvent) {
	const amount = props.step ?? (props.max - props.min) / 100;
	// 対数操作ではキー1回で操作面の1%分を移動し、ドラッグと同じ倍率の感覚にする。
	const move = (value: number, direction: number) => useLogarithmic.value ? fromRatio(toRatio(value) + direction / 100) : value + direction * amount;
	if (event.key === 'ArrowLeft' && axisLock.value !== 'y') setValue(move(value.value[0], -1), value.value[1], 'x');
	else if (event.key === 'ArrowRight' && axisLock.value !== 'y') setValue(move(value.value[0], 1), value.value[1], 'x');
	else if (event.key === 'ArrowDown' && axisLock.value !== 'x') setValue(value.value[0], move(value.value[1], -1), 'y');
	else if (event.key === 'ArrowUp' && axisLock.value !== 'x') setValue(value.value[0], move(value.value[1], 1), 'y');
	else return;
	event.preventDefault();
}

function toggleAxisLock(axis: Exclude<AxisLock, null>) {
	emit('disableRatioLock');
	axisLock.value = axisLock.value === axis ? null : axis;
}

function formatValue(number: number): string {
	if (useLogarithmic.value) return Number(number.toPrecision(5)).toString();
	return Number(number.toFixed(10)).toString();
}
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 20px;
	box-sizing: border-box;
	width: 250px;
}

.surface {
	position: relative;
	width: 100%;
	aspect-ratio: 1;
	box-sizing: border-box;
	border-radius: 5px;
	background-color: var(--THEME-bg);
	background-image:
		linear-gradient(to right, color-mix(in srgb, var(--THEME-fg) 12%, transparent) 1px, transparent 1px),
		linear-gradient(to bottom, color-mix(in srgb, var(--THEME-fg) 12%, transparent) 1px, transparent 1px);
	background-size: 25% 25%;
	cursor: crosshair;
	touch-action: none;
	user-select: none;

	&.lockedX {
		cursor: ew-resize;
	}

	&.lockedY {
		cursor: ns-resize;
	}

	&:focus-visible {
		outline: 2px solid var(--THEME-accent);
		outline-offset: 2px;
	}
}

.horizontalGuide,
.verticalGuide {
	position: absolute;
	pointer-events: none;
	background: color-mix(in srgb, var(--THEME-accent) 45%, transparent);
}

.horizontalGuide {
	left: 0;
	width: 100%;
	height: 1px;
}

.verticalGuide {
	top: 0;
	width: 1px;
	height: 100%;
}

.point {
	position: absolute;
	width: 14px;
	height: 14px;
	box-sizing: border-box;
	border-radius: 50%;
	background: var(--THEME-accent);
	box-shadow: 0 0 0 3px color-mix(in srgb, var(--THEME-accent) 25%, transparent);
	transform: translate(-50%, -50%);
	pointer-events: none;
}

.side {
	display: flex;
	align-items: center;
	gap: 6px;
}
</style>
