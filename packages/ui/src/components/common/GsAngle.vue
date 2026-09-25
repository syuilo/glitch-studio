<template>
<div :class="$style.root">
	<div
		ref="surface"
		:class="[$style.direction, { [$style.dragging]: activePointerId != null }]"
		:title="formatAngle(value)"
		@pointerdown="onPointerDown"
		@pointermove="onPointerMove"
		@pointerup="onPointerUp"
		@pointercancel="onPointerCancel"
		@lostpointercapture="onPointerCancel"
	>
		<div :class="$style.needle" :style="{ transform: `rotate(${value * 180}deg)` }">
			<div :class="$style.knob"></div>
		</div>
		<div :class="$style.center"></div>
	</div>
	<div :class="$style.control">
		<div :class="$style.value">{{ formatAngle(value) }}</div>
		<GsButton small :primary="snapEnabled" title="Snap to step (hold Shift to disable)" @click="snapEnabled = !snapEnabled">
			Snap {{ snapEnabled ? 'On' : 'Off' }}
		</GsButton>
	</div>
</div>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import GsButton from './GsButton.vue';

const props = withDefaults(defineProps<{
	modelValue: number;
	step?: number;
}>(), { step: 0.001 });

const emit = defineEmits<{
	(ev: 'update:modelValue', value: number): void;
	(ev: 'beginChanging'): void;
	(ev: 'changeFinished'): void;
}>();

const surface = useTemplateRef<HTMLElement>('surface');
const value = ref(props.modelValue);
const snapEnabled = ref(true);
const activePointerId = ref<number | null>(null);

watch(() => props.modelValue, (newValue) => {
	value.value = newValue;
});

function updateFromPointer(event: PointerEvent) {
	if (surface.value == null) return;
	const bounds = surface.value.getBoundingClientRect();
	const x = event.clientX - (bounds.left + bounds.width / 2);
	const y = event.clientY - (bounds.top + bounds.height / 2);
	// 中心付近では方向が定まらず小さな移動で角度が跳ねるため、現在値を維持する。
	if (Math.hypot(x, y) < 2) return;

	// 上を0、時計回りを正にし、従来と同じく1を180度として扱う。
	let angle = Math.atan2(x, -y) / Math.PI;
	if (snapEnabled.value && !event.shiftKey && Number.isFinite(props.step) && props.step > 0) {
		angle = Number((Math.round(angle / props.step) * props.step).toFixed(10));
	}
	angle = Math.min(1, Math.max(-1, angle));
	if (value.value === angle) return;
	value.value = angle;
	emit('update:modelValue', angle);
}

function onPointerDown(event: PointerEvent) {
	if (event.button !== 0 || activePointerId.value != null) return;
	event.preventDefault();
	activePointerId.value = event.pointerId;
	surface.value?.setPointerCapture(event.pointerId);
	window.addEventListener('blur', finishDrag);
	emit('beginChanging');
	updateFromPointer(event);
}

function onPointerMove(event: PointerEvent) {
	if (activePointerId.value !== event.pointerId) return;
	updateFromPointer(event);
}

function onPointerUp(event: PointerEvent) {
	if (activePointerId.value !== event.pointerId) return;
	updateFromPointer(event);
	finishDrag();
}

function onPointerCancel(event: PointerEvent) {
	if (activePointerId.value !== event.pointerId) return;
	finishDrag();
}

function finishDrag() {
	const pointerId = activePointerId.value;
	if (pointerId == null) return;
	activePointerId.value = null;
	window.removeEventListener('blur', finishDrag);
	if (surface.value?.hasPointerCapture(pointerId)) surface.value.releasePointerCapture(pointerId);
	emit('changeFinished');
}

onBeforeUnmount(finishDrag);

function formatAngle(value: number): string {
	return `${Math.round(value * 1000) / 1000} (${Math.round(value * 1800) / 10}°)`;
}
</script>

<style module>
.root {
	display: flex;
	align-items: center;
	gap: 10px;
}

.direction {
	position: relative;
	flex: 0 0 80px;
	height: 80px;
	box-sizing: border-box;
	border: 1px solid var(--THEME-divider);
	border-radius: 50%;
	background: var(--THEME-bg);
	cursor: grab;
	touch-action: none;
	user-select: none;
}

.dragging {
	cursor: grabbing;
}

.needle {
	position: absolute;
	left: calc(50% - 1px);
	bottom: 50%;
	width: 2px;
	height: calc(50% - 10px);
	background: var(--THEME-accent);
	transform-origin: center bottom;
	pointer-events: none;
}

.knob,
.center {
	position: absolute;
	left: 50%;
	border-radius: 50%;
	background: var(--THEME-accent);
	transform: translate(-50%, -50%);
	pointer-events: none;
}

.knob {
	top: 0;
	width: 12px;
	height: 12px;
	box-shadow: 0 0 0 3px color-mix(in srgb, var(--THEME-accent) 25%, transparent);
}

.center {
	top: 50%;
	width: 5px;
	height: 5px;
}

.control {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 8px;
	flex: 1;
	min-width: 0;
}

.value {
	font-size: 0.85em;
	font-variant-numeric: tabular-nums;
	opacity: 0.7;
}
</style>
