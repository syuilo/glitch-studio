<template>
<GsModal ref="modal" zPriority="high" :anchorElement="anchorElement" :transparentBg="true" @click="closeEditor" @esc="closeEditor" @close="onClosing" @closed="emit('closed')">
	<div class="_shadow _popup" :class="$style.root" data-test-color-ramp-editor tabindex="-1" @keydown.stop="onKeydown">
		<div :class="$style.header">
			<b>{{ title ?? i18n.ts._ColorRamp.Title }}</b>
			<div v-tooltip="i18n.ts.Close" class="_button" :class="$style.close" data-test-color-ramp-close tabindex="0" @click="closeEditor" @keydown.enter.prevent="closeEditor" @keydown.space.prevent="closeEditor"><i class="ti ti-x"></i></div>
		</div>
		<div ref="track" :class="$style.track" data-test-color-ramp-track @dblclick="addAtPointer">
			<GsColorRampPreview :ramp="modelValue"/>
			<div
				v-for="(stop, index) in modelValue.stops" :key="stop.id" v-tooltip="i18n.tsx._ColorRamp.StopLabel({ index: index + 1, position: stop.position })" class="_button" :class="[$style.stop, { [$style.selected]: selectedId === stop.id }]"
				data-test-color-ramp-stop :data-stop-id="stop.id" :style="{ left: `${stop.position * 100}%`, background: colorCss(stop.color) }"
				tabindex="0"
				@pointerdown.stop.prevent="startDrag($event, stop.id)" @dblclick.stop @click="selectedId = stop.id" @focus="selectedId = stop.id" @keydown="onStopKeydown($event, stop.id)"
			>
			</div>
		</div>
		<div :class="$style.actions">
			<GsSelect data-test-color-ramp-selection :modelValue="selectedId" :items="modelValue.stops.map((stop, index) => ({ value: stop.id, label: i18n.tsx._ColorRamp.StopLabel({ index: index + 1, position: stop.position.toFixed(3) }) }))" @update:modelValue="selectedId = $event"/>
			<GsButton v-tooltip="i18n.ts._ColorRamp.AddStop" data-test-color-ramp-add iconOnly icon="ti ti-plus" @click="addStop(0.5)"/>
			<GsButton v-tooltip="i18n.ts._ColorRamp.RemoveStop" data-test-color-ramp-remove iconOnly danger icon="ti ti-minus" :disabled="modelValue.stops.length <= 1" @click="removeStop"/>
		</div>
		<template v-if="selectedStop != null">
			<GsInput data-test-color-ramp-position type="number" :modelValue="selectedStop.position" :min="0" :max="1" :step="0.01" @update:modelValue="updatePosition($event)">
				<template #label>{{ i18n.ts._ColorRamp.Position }}</template>
			</GsInput>
			<GsColorInput :key="selectedStop.id" :modelValue="normalizeColor(selectedStop.color)" :title="title" @update:modelValue="updateStop({ color: $event })"/>
		</template>
		<GsSelect
			data-test-color-ramp-interpolation :modelValue="modelValue.interpolation" :items="[
				{ value: 'constant', label: i18n.ts._ColorRamp.Constant }, { value: 'linear', label: i18n.ts._ColorRamp.Linear }, { value: 'smoothstep', label: i18n.ts._ColorRamp.Smoothstep },
			]" @update:modelValue="updateRamp({ interpolation: $event })"
		>
			<template #label>{{ i18n.ts._ColorRamp.Interpolation }}</template>
		</GsSelect>
		<GsSelect
			data-test-color-ramp-color-space :modelValue="modelValue.colorSpace" :items="[
				{ value: 'srgb', label: 'sRGB' }, { value: 'linearSrgb', label: 'Linear sRGB' }, { value: 'oklab', label: 'Oklab' },
			]" @update:modelValue="updateRamp({ colorSpace: $event })"
		>
			<template #label>{{ i18n.ts._ColorRamp.ColorSpace }}</template>
		</GsSelect>
	</div>
</GsModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import { evaluatePreparedColorRamp, prepareColorRamp } from '@gs/shared/color-ramp.ts';
import { genId } from '@gs/shared/utility/id.ts';
import GsModal from './GsModal.vue';
import GsColorRampPreview from './GsColorRampPreview.vue';
import GsColorInput from './GsColorInput.vue';
import GsInput from './GsInput.vue';
import GsSelect from './GsSelect.vue';
import GsButton from './GsButton.vue';
import type { ColorRamp, ColorRampColor, ColorRampStop } from '@gs/shared/color-ramp.ts';
import { listenPointerDrag } from '@/utility/pointer-drag.ts';
import { colorCss, normalizeColor } from '@/utility/color-input.ts';
import { i18n } from '@/i18n.ts';

const props = defineProps<{ modelValue: ColorRamp; anchorElement: HTMLElement; title?: string }>();
const emit = defineEmits<{
	(ev: 'update:modelValue', value: ColorRamp): void;
	(ev: 'closing'): void;
	(ev: 'closed'): void;
}>();
const modal = useTemplateRef('modal');
const selectedId = ref('');
const selectedStop = computed(() => props.modelValue.stops.find(stop => stop.id === selectedId.value) ?? null);
const track = useTemplateRef('track');
let stopDrag: (() => void) | null = null;

function closeEditor() {
	modal.value?.close();
}

function onClosing() {
	stopDrag?.();
	emit('closing');
}

function onKeydown(event: KeyboardEvent) {
	if (event.key === 'Escape' && !event.isComposing) {
		event.preventDefault();
		closeEditor();
	}
}

function updateRamp(changes: Partial<ColorRamp>) { emit('update:modelValue', { ...props.modelValue, ...changes }); }

function updateStop(changes: Partial<Pick<ColorRampStop, 'position' | 'color'>>) {
	updateRamp({ stops: props.modelValue.stops.map(stop => stop.id === selectedId.value ? { ...stop, ...changes } : stop) });
}

function updatePosition(position: number) {
	if (!Number.isFinite(position)) return;
	const clamped = Math.min(1, Math.max(0, position));
	if (selectedStop.value?.position !== clamped) updateStop({ position: clamped });
}

function addStop(position: number) {
	const color = evaluatePreparedColorRamp(prepareColorRamp(props.modelValue), position);
	const alpha = color[3];
	const unpremultiplied: ColorRampColor = alpha > 0 ? [color[0] / alpha, color[1] / alpha, color[2] / alpha, alpha] : [0, 0, 0, 0];
	const id = genId();
	updateRamp({ stops: [...props.modelValue.stops, { id, position, color: unpremultiplied }] });
	selectedId.value = id;
}

function removeStop() {
	if (props.modelValue.stops.length <= 1) return;
	const stops = props.modelValue.stops.filter(stop => stop.id !== selectedId.value);
	selectedId.value = stops[0].id;
	updateRamp({ stops });
}

function positionAtPointer(event: MouseEvent) {
	const bounds = track.value?.getBoundingClientRect();
	return bounds == null || bounds.width <= 0 ? 0.5 : Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
}

function addAtPointer(event: MouseEvent) { addStop(positionAtPointer(event)); }

function startDrag(event: PointerEvent, id: string) {
	if (event.button !== 0) return;
	stopDrag?.();
	selectedId.value = id;
	(event.currentTarget as HTMLElement).focus({ preventScroll: true });
	const initialStopPosition = selectedStop.value?.position;
	const trackWidth = track.value?.getBoundingClientRect().width;
	if (initialStopPosition == null || trackWidth == null || trackWidth <= 0) return;
	// 押下位置からの移動量を使い、ハンドルの端を選択しただけでは位置を変えない。
	// pointerupでも更新されるため、絶対座標を使うとドラッグしなくても色の対応が変わってしまう。
	// 並び替えずIDで編集する。stopが交差・重複しても選択中の色を維持する。
	stopDrag = listenPointerDrag(event, current => updatePosition(initialStopPosition + (current.clientX - event.clientX) / trackWidth), () => { stopDrag = null; });
}

function onStopKeydown(event: KeyboardEvent, id: string) {
	selectedId.value = id;
	if (event.key === ' ' || event.key === 'Enter') event.preventDefault();
	if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeStop(); }
	if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
		event.preventDefault();
		updatePosition((selectedStop.value?.position ?? 0) + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 0.1 : 0.01));
	}
}

watch(() => props.modelValue.stops.map(stop => stop.id), ids => {
	if (!ids.includes(selectedId.value)) { stopDrag?.(); selectedId.value = ids[0]; }
}, { immediate: true });
onBeforeUnmount(() => stopDrag?.());
</script>

<style module lang="scss">
.root {
	display: grid;
	gap: 12px;
	box-sizing: border-box;
	width: 360px;
	max-width: 100vw;
	max-height: calc(100dvh - 32px);
	overflow: auto;
	padding: 14px;
	border-radius: 10px;
}

.header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.close {
	padding: 6px;
	border-radius: 6px;
}

.track {
	position: relative;
	margin: 0 9px 12px;
	touch-action: none;
}

.stop {
	position: absolute;
	top: 18px;
	width: 16px;
	height: 20px;
	border: 2px solid #aaa;
	border-radius: 3px;
	transform: translateX(-50%);
	box-shadow: 0 1px 3px #0008;
	touch-action: none;
}

.selected {
	border-color: #fff;
	outline: 2px solid var(--THEME-accent);
	z-index: 1;
}

.actions {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto auto;
	align-items: end;
	gap: 6px;
}
</style>
