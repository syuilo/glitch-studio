<template>
<GsModal ref="modal" zPriority="high" :anchorElement="anchorElement" :transparentBg="true" @click="closeEditor" @esc="closeEditor" @close="onClosing" @closed="emit('closed')">
	<div class="_shadow _popup" :class="$style.root" data-test-color-ramp-editor tabindex="-1" @keydown.stop="onKeydown">
		<div :class="$style.header">
			<div :class="$style.headerLeft">
				<b>{{ title ?? i18n.ts._ColorRamp.Title }}</b>
			</div>
			<div :class="$style.headerRight">
				<GsButton v-tooltip="i18n.ts._ColorRamp.ReverseStops" data-test-color-ramp-reverse iconOnly icon="ti ti-flip-horizontal" @click="reverseStops"/>
				<div :class="$style.headerDivider"></div>
				<button v-tooltip="i18n.ts.Close" class="_button" :class="$style.close" data-test-color-ramp-close tabindex="0" @click="closeEditor" @keydown.enter.prevent="closeEditor" @keydown.space.prevent="closeEditor"><i class="ti ti-x"></i></button>
			</div>
		</div>
		<div :class="$style.body">
			<div :class="$style.leftArea" class="_gaps_m">
				<div ref="track" :class="$style.track" data-test-color-ramp-track @dblclick="addAtPointer">
					<div style="height: 24px;">
						<GsColorRampPreview :ramp="modelValue"/>
					</div>
					<div :class="$style.stops">
						<div
							v-for="stop in displayedStops"
							:key="stop.id"
							:class="[$style.stop, { [$style.selected]: selectedId === stop.id }]"
							data-test-color-ramp-stop
							:data-stop-id="stop.id"
							:style="{ left: `${stop.position * 100}%`, '--color': colorCss(stop.color), visibility: removedStopDuringDrag?.stop.id === stop.id ? 'hidden' : 'visible' }"
							tabindex="0"
							@pointerdown.stop.prevent="startDrag($event, stop.id)"
							@dblclick.stop
							@click="selectedId = stop.id"
							@focus="selectedId = stop.id"
							@keydown="onStopKeydown($event, stop.id)"
						></div>
					</div>
				</div>
				<template v-if="selectedStop != null">
					<GsInput data-test-color-ramp-position type="number" :modelValue="selectedStop.position" :min="0" :max="1" :step="0.01" @update:modelValue="updatePosition($event)">
						<template #prefix>Pos:</template>
					</GsInput>
					<GsColorInput :key="selectedStop.id" :modelValue="normalizeColor(selectedStop.color)" :title="title" @update:modelValue="updateStop({ color: $event })"/>
				</template>
				<hr>
				<GsSelect
					data-test-color-ramp-interpolation :modelValue="modelValue.interpolation" :items="[
						{ value: 'constant', label: i18n.ts._ColorRamp.Constant }, { value: 'linear', label: i18n.ts._ColorRamp.Linear }, { value: 'smoothstep', label: i18n.ts._ColorRamp.Smoothstep },
						{ value: 'smootherstep', label: i18n.ts._ColorRamp.Smootherstep }, { value: 'easeIn', label: i18n.ts._ColorRamp.EaseIn }, { value: 'easeOut', label: i18n.ts._ColorRamp.EaseOut },
					]" @update:modelValue="updateRamp({ interpolation: $event })"
				>
					<template #label>{{ i18n.ts._ColorRamp.Interpolation }}</template>
				</GsSelect>
				<GsSelect
					data-test-color-ramp-color-space :modelValue="modelValue.colorSpace" :items="[
						{ value: 'srgb', label: 'sRGB' }, { value: 'linearSrgb', label: 'Linear sRGB' }, { value: 'oklab', label: 'Oklab' }, { value: 'oklch', label: 'OKLCH' },
					]" @update:modelValue="updateRamp({ colorSpace: $event })"
				>
					<template #label>{{ i18n.ts._ColorRamp.ColorSpace }}</template>
				</GsSelect>
				<GsSelect
					v-if="modelValue.colorSpace === 'oklch'"
					data-test-color-ramp-hue-interpolation :modelValue="modelValue.hueInterpolation ?? 'shorter'" :items="[
						{ value: 'shorter', label: i18n.ts._ColorRamp.ShorterHue }, { value: 'longer', label: i18n.ts._ColorRamp.LongerHue },
						{ value: 'increasing', label: i18n.ts._ColorRamp.IncreasingHue }, { value: 'decreasing', label: i18n.ts._ColorRamp.DecreasingHue },
					]" @update:modelValue="updateRamp({ hueInterpolation: $event })"
				>
					<template #label>{{ i18n.ts._ColorRamp.HueInterpolation }}</template>
				</GsSelect>
			</div>
			<div :class="$style.rightArea">
				<GsFolder data-test-color-ramp-presets defaultOpen :maxHeight="240">
					<template #label>{{ i18n.ts._ColorRamp.Presets }}</template>
					<div :class="$style.presets">
						<button
							v-for="{ preset, ramp } in presetPreviews"
							:key="preset.id"
							type="button"
							class="_button"
							:class="$style.preset"
							data-test-color-ramp-preset
							:data-preset-id="preset.id"
							@click="applyPreset(preset)"
						>
							<GsColorRampPreview :ramp="ramp" data-test-color-ramp-preset-preview/>
						</button>
					</div>
				</GsFolder>
			</div>
		</div>
	</div>
</GsModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { evaluatePreparedColorRamp, prepareColorRamp } from '@gs/shared/color-ramp.ts';
import { genId } from '@gs/shared/utility/id.ts';
import GsModal from './GsModal.vue';
import GsColorRampPreview from './GsColorRampPreview.vue';
import GsColorInput from './GsColorInput.vue';
import GsInput from './GsInput.vue';
import GsSelect from './GsSelect.vue';
import GsButton from './GsButton.vue';
import GsFolder from './GsFolder.vue';
import type { ColorRamp, ColorRampColor, ColorRampStop } from '@gs/shared/color-ramp.ts';
import type { ColorRampPreset } from '@/color-ramp-presets.ts';
import { COLOR_RAMP_PRESETS } from '@/color-ramp-presets.ts';
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
const stopChoices = computed(() => props.modelValue.stops.map((stop, index) => ({
	value: stop.id,
	label: i18n.tsx._ColorRamp.StopLabel({ index: index + 1, position: stop.position.toFixed(3) }),
})));
// stopのドラッグでは一覧を再描画せず、補間設定が変わった場合だけプレビューを作り直す。
// 各設定をスカラーのcomputedに分け、modelValueの置き換えだけでは依存先を更新しない。
const presetPreviewInterpolation = computed(() => props.modelValue.interpolation);
const presetPreviewColorSpace = computed(() => props.modelValue.colorSpace);
const presetPreviewHueInterpolation = computed(() => props.modelValue.hueInterpolation);
const presetPreviews = computed(() => COLOR_RAMP_PRESETS.map(preset => ({
	preset,
	ramp: {
		interpolation: presetPreviewInterpolation.value,
		colorSpace: presetPreviewColorSpace.value,
		hueInterpolation: presetPreviewHueInterpolation.value,
		// プレビューにも有効なstop IDが必要だが、編集用のIDは適用時に発行する。
		stops: preset.stops.map((stop, index) => ({ id: String(index), position: stop.position, color: [...stop.color] as ColorRampColor })),
	},
})));
const track = useTemplateRef('track');
const STOP_DRAG_REMOVAL_DISTANCE = 40;
const removedStopDuringDrag = shallowRef<{ stop: ColorRampStop; index: number; remainingStopIds: string[] } | null>(null);
const displayedStops = computed(() => {
	const removed = removedStopDuringDrag.value;
	if (removed == null || props.modelValue.stops.some(stop => stop.id === removed.stop.id)) return props.modelValue.stops;
	// Capture先のDOMを削除すると追跡が終了し、範囲内へ戻しても復元できなくなる。
	// モデルからは即座に取り除き、ハンドルだけを元の順序で非表示のまま残す。
	const stops = [...props.modelValue.stops];
	stops.splice(removed.index, 0, removed.stop);
	return stops;
});
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

function applyPreset(preset: ColorRampPreset) {
	stopDrag?.();
	const stops: ColorRampStop[] = preset.stops.map(stop => ({ id: genId(), position: stop.position, color: [...stop.color] }));
	updateRamp({ stops });
	selectedId.value = stops[0].id;
}

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

function reverseStops() {
	stopDrag?.();
	// 保存順とIDを保ち、同位置のstopの優先順位や選択対象を変えずに位置だけを反転する。
	updateRamp({ stops: props.modelValue.stops.map(stop => ({ ...stop, position: 1 - stop.position })) });
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
	stopDrag = listenPointerDrag(event, current => {
		const position = Math.min(1, Math.max(0, initialStopPosition + (current.clientX - event.clientX) / trackWidth));
		const removed = removedStopDuringDrag.value;
		const outsideRemovalRange = Math.abs(current.clientY - event.clientY) >= STOP_DRAG_REMOVAL_DISTANCE;
		if (outsideRemovalRange && (removed != null || props.modelValue.stops.length > 1)) {
			if (removed != null) return;
			const index = props.modelValue.stops.findIndex(stop => stop.id === id);
			if (index < 0) return;
			const stops = props.modelValue.stops.filter(stop => stop.id !== id);
			removedStopDuringDrag.value = { stop: props.modelValue.stops[index], index, remainingStopIds: stops.map(stop => stop.id) };
			updateRamp({ stops });
			return;
		}
		if (removed != null) {
			const stops = [...props.modelValue.stops];
			// 同位置のstopは保存順で優先度が変わるため、末尾へ追加せず元の位置へ復元する。
			stops.splice(removed.index, 0, { ...removed.stop, position });
			removedStopDuringDrag.value = null;
			updateRamp({ stops });
		} else {
			const stop = props.modelValue.stops.find(stop => stop.id === id);
			if (stop != null && stop.position !== position) {
				updateRamp({ stops: props.modelValue.stops.map(stop => stop.id === id ? { ...stop, position } : stop) });
			}
		}
	}, () => {
		stopDrag = null;
		// pointerupで復元した値はまだ親のpropsへ反映されていないため、
		// 一時削除が残っている場合だけ、生きている別のstopへ選択を移す。
		if (removedStopDuringDrag.value != null) selectedId.value = props.modelValue.stops.find(stop => stop.id !== id)?.id ?? props.modelValue.stops[0].id;
		removedStopDuringDrag.value = null;
	});
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
	const removed = removedStopDuringDrag.value;
	if (removed != null) {
		// 自分の一時削除では選択・Captureを維持する。外部からstop構成が変わった場合は
		// ドラッグを終了し、別のランプへ削除前のstopを復元しない。
		if (ids.length === removed.remainingStopIds.length && ids.every((id, index) => id === removed.remainingStopIds[index])) return;
		stopDrag?.();
	}
	if (!ids.includes(selectedId.value)) { stopDrag?.(); selectedId.value = ids[0]; }
}, { immediate: true });
onBeforeUnmount(() => stopDrag?.());
</script>

<style module lang="scss">
.root {
	box-sizing: border-box;
	width: 800px;
	max-width: 100vw;
	height: 350px;
	overflow: auto;
	padding: 14px;
	border-radius: 10px;
	outline: none;
}

.header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	margin-bottom: 6px;
}

.headerLeft {
	display: flex;
	align-items: center;
	justify-content: flex-start;
}

.headerRight {
	display: flex;
	align-items: center;
	justify-content: flex-end;
}

.headerDivider {
	width: 1px;
	height: 20px;
	margin: 0 10px;
	background-color: #fff2;
}

.close {
	padding: 6px;
	border-radius: 6px;
}

.body {
	display: flex;
	flex-direction: row;
	gap: 16px;
}
.leftArea {
	flex: 0.5;
}
.rightArea {
	flex: 0.5;
}

.track {
	--stopLineHeight: 8px;
	--stopHandleSize: 20px;

	position: relative;
	margin: 0 calc(var(--stopHandleSize) / 2);
	touch-action: none;
}

.stops {
	position: relative;
	height: calc(var(--stopLineHeight) + var(--stopHandleSize));
}

.stop {
	position: absolute;
	top: 0px;
	transform: translateX(-50%);
	touch-action: none;

	&:before {
		content: '';
		display: block;
		position: relative;
		top: 0;
		left: 50%;
		width: 1px;
		height: var(--stopLineHeight);
		background: #fffa;
		transform: translateX(-50%);
	}

	&:after {
		content: '';
		display: block;
		position: relative;
		width: var(--stopHandleSize);
		height: var(--stopHandleSize);
		box-sizing: border-box;
		background: var(--color);
		border: 2px solid #fffa;
		border-radius: 999px;
	}
}

.selected {
	z-index: 1;

	&:before {
		background: var(--THEME-accent);
	}

	&:after {
		border-color: var(--THEME-accent);
	}
}

.presets {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 8px;
}

.preset {
	min-width: 0;
	height: 28px;
	border-radius: 4px;
	outline-offset: 2px;

	&:hover,
	&:focus-visible {
		outline: 2px solid var(--THEME-accent);
	}
}
</style>
