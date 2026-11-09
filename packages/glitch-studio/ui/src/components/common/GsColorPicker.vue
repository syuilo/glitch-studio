<template>
<GsModal
	ref="modal"
	:manualShowing="manualShowing"
	:zPriority="'high'"
	:anchorElement="anchorElement"
	:transparentBg="true"
	@click="close"
	@close="onModalClose"
	@closed="onModalClosed"
>
	<div :class="$style.root" class="_shadow _popup" tabindex="-1" @keydown.stop="onKeydown">
		<div :class="$style.header">
			<b>{{ title ?? i18n.ts.Color }}</b>
			<div :class="$style.actions">
				<div v-if="EyeDropper" :class="[$style.button, { [$style.busy]: picking }]" :title="i18n.ts._ColorPicker.PickFromScreen" tabindex="0" @click="pickFromScreen" @keydown.enter.prevent="pickFromScreen"><i class="ti ti-color-picker"></i></div>
				<div :class="$style.button" :title="i18n.ts.Close" tabindex="0" @click="close" @keydown.enter.prevent="close"><i class="ti ti-x"></i></div>
			</div>
		</div>
		<div :class="$style.body">
			<div :class="$style.leftArea">
				<div :class="$style.mapModes" role="group">
					<button v-for="mode in ['hsv', 'oklch'] as const" :key="mode" class="_button" :class="[$style.mapMode, { [$style.active]: mapMode === mode }]" :data-test-color-picker-mode="mode" @click="setMapMode(mode)">{{ mode.toUpperCase() }}</button>
				</div>
				<div :class="$style.mapAxes">
					<span>{{ mapMode === 'hsv' ? 'V ↑' : 'L ↑ 0–100%' }}</span>
					<span>{{ mapMode === 'hsv' ? 'S →' : `C → 0–${OKLCH_MAP_MAX_CHROMA}` }}</span>
				</div>
				<div
					:class="[$style.map, { [$style.hsvMap]: mapMode === 'hsv' }]" :style="mapMode === 'hsv' ? { backgroundColor: `hsl(${hue} 100% 50%)` } : {}"
					data-test-color-picker-map
					tabindex="0"
					@pointerdown="startDrag($event, 'map')"
					@pointermove="moveDrag"
					@pointerup="endDrag"
					@pointercancel="endDrag"
					@lostpointercapture="endDrag"
					@keydown="onMapKeydown"
				>
					<GsOklchColorMap v-if="mapMode === 'oklch'" :hue="oklch[2]"/>
					<div :class="$style.thumb" :style="{ left: `${mapPosition[0] * 100}%`, top: `${mapPosition[1] * 100}%`, background: colorCss(color) }" data-test-color-picker-map-thumb></div>
				</div>
				<div :class="$style.sliderRow">
					<div
						:class="[$style.track, { [$style.hsvHue]: mapMode === 'hsv' }]" :style="mapMode === 'oklch' ? { backgroundImage: OKLCH_HUE_GRADIENT } : {}"
						data-test-color-picker-hue role="slider"
						tabindex="0"
						@pointerdown="startDrag($event, 'hue')"
						@pointermove="moveDrag"
						@pointerup="endDrag"
						@pointercancel="endDrag"
						@lostpointercapture="endDrag"
						@keydown="onHueKeydown"
					>
						<div :class="$style.thumb" :style="{ left: `${mapHue / 360 * 100}%` }" data-test-color-picker-hue-thumb></div>
					</div>
				</div>
				<div :class="$style.sliderRow">
					<div :class="[$style.track, $style.checker]" data-test-color-picker-alpha @pointerdown="startDrag($event, 'alpha')" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag">
						<div :class="$style.alpha" :style="{ background: `linear-gradient(to right, ${colorCss([color[0], color[1], color[2], 0])}, ${colorCss([color[0], color[1], color[2], 1])})` }"></div>
						<div :class="$style.thumb" :style="{ left: `${color[3] * 100}%` }"></div>
					</div>
				</div>
				<div v-if="mapMode === 'oklch'" :class="$style.mapHint">
					<div v-if="outsideMapRange" data-test-color-picker-outside-map>{{ i18n.ts._ColorPicker.OutsideMapRange }}</div>
				</div>
			</div>
			<div :class="$style.rightArea">
				<div v-for="row in rows" :key="row.name" :class="$style.row">
					<span :class="$style.format">{{ row.name }}</span>
					<div v-for="field in row.fields" :key="field.key" :class="$style.field">
						<span :class="$style.label">{{ field.label }}</span>
						<div
							:class="[$style.editor, { [$style.invalid]: invalid === field.key }]"
							class="_monospace"
							contenteditable="plaintext-only"
							:spellcheck="false"
							:inputmode="row.name === 'HEX' ? 'text' : 'decimal'"
							:data-test-color-picker-field="field.key"
							@focus="editing = field.key"
							@input="editField($event, row.name, field.index, field.key)"
							@blur="finishEdit($event, field.key)"
							@keydown.enter.prevent="blurEditor"
							@keydown.esc.stop.prevent="blurEditor"
							v-text="drafts[field.key]"
						></div>
					</div>
				</div>
				<div v-if="error" :class="$style.error">{{ error }}</div>
			</div>
		</div>
		<div :class="$style.recentTitle">{{ i18n.ts._ColorPicker.RecentColors }}</div>
		<div :class="$style.recent">
			<div v-for="(recentColor, index) in recent" :key="index" :class="[$style.swatch, $style.checker]" :title="colorHex(recentColor)" tabindex="0" @click="setColor(recentColor)" @keydown.enter.prevent="setColor(recentColor)">
				<div :class="$style.fill" :style="{ background: colorCss(recentColor) }"></div>
			</div>
			<span v-if="recent.length === 0" :class="$style.empty">{{ i18n.ts._ColorPicker.NoRecentColors }}</span>
		</div>
	</div>
</GsModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import { linearSrgbToSrgb, oklchToLinearSrgb, srgbChannelToLinear } from '@gs/shared/color-space.ts';
import type { RgbaColor } from '@/utility/color-input.ts';
import { i18n } from '@/i18n.ts';
import { clampColorValue, colorCss, colorHex, hsvToHsl, hsvToRgb, normalizeColor, parseColorHex, rgbToHsv, rgbToOklch } from '@/utility/color-input.ts';
import { OKLCH_HUE_GRADIENT, OKLCH_MAP_MAX_CHROMA } from '@/utility/color-picker-map.ts';
import GsModal from '@/components/common/GsModal.vue';
import GsOklchColorMap from '@/components/common/GsOklchColorMap.vue';

const props = defineProps<{
	modelValue: RgbaColor;
	anchorElement: HTMLElement;
	title?: string;
}>();

const modal = useTemplateRef('modal');
const manualShowing = ref(true);
const hiding = ref(false);

const emit = defineEmits<{
	(ev: 'update:modelValue', value: RgbaColor): void;
	(ev: 'closed'): void;
	(ev: 'closing'): void;
}>();

const color = ref<RgbaColor>(normalizeColor(props.modelValue));
const initialHsv = rgbToHsv(color.value, 0);
const hue = ref(initialHsv[0]);
const saturation = ref(initialHsv[1]);
const brightness = ref(initialHsv[2]);
const oklch = ref(rgbToOklch(color.value, 0));
const mapMode = ref<'hsv' | 'oklch'>('hsv');
const mapHue = computed(() => mapMode.value === 'hsv' ? hue.value : oklch.value[2]);
const mapPosition = computed(() => mapMode.value === 'hsv'
	? [saturation.value, 1 - brightness.value]
	: [clampColorValue(oklch.value[1] / OKLCH_MAP_MAX_CHROMA), 1 - clampColorValue(oklch.value[0])]);
const outsideMapRange = computed(() => oklch.value[0] < 0 || oklch.value[0] > 1 || oklch.value[1] > OKLCH_MAP_MAX_CHROMA);
const editing = ref<string | null>(null);
const invalid = ref<string | null>(null);
const drafts = ref<Record<string, string>>({});
const error = ref('');
const picking = ref(false);
let changed = false;
const storageKey = 'glitch-studio:recent-colors';
const recent = ref<RgbaColor[]>(readRecent());
const eyeDropperAbort = new AbortController();
const EyeDropper = (window as Window & {
	EyeDropper?: new () => { open(options: { signal: AbortSignal }): Promise<{ sRGBHex: string }> };
}).EyeDropper;

type Format = 'sRGB' | 'HSL' | 'OKLCH' | 'HEX' | 'Linear';
const rows = computed(() => {
	const hsl = hsvToHsl(hue.value, saturation.value, brightness.value);
	const definitions: { name: Format; labels: string[]; values: (string | number)[] }[] = [
		{ name: 'sRGB', labels: ['R', 'G', 'B', 'A'], values: [...linearSrgbToSrgb(color.value).slice(0, 3).map(v => Math.round(clampColorValue(v) * 255)), color.value[3]] },
		{ name: 'HSL', labels: ['H°', 'S%', 'L%', 'A'], values: [hsl[0], hsl[1] * 100, hsl[2] * 100, color.value[3]] },
		{ name: 'OKLCH', labels: ['L%', 'C', 'H°', 'A'], values: [oklch.value[0] * 100, oklch.value[1], oklch.value[2], color.value[3]] },
		{ name: 'HEX', labels: ['#RRGGBBAA'], values: [colorHex(color.value)] },
		{ name: 'Linear', labels: ['R', 'G', 'B', 'A'], values: color.value },
	];
	return definitions.map(row => ({
		name: row.name,
		fields: row.values.map((value, index) => ({
			key: `${row.name}-${index}`,
			index,
			label: row.labels[index],
			value: typeof value === 'number' ? String(Number(value.toFixed(4))) : value,
		})),
	}));
});

watch(rows, () => {
	// 編集中のDOMを書き換えるとカーソル位置が失われるため、他の欄だけ同期する。
	for (const row of rows.value) for (const field of row.fields) {
		if (editing.value !== field.key) drafts.value[field.key] = field.value;
	}
}, { immediate: true, flush: 'sync' });

watch(() => props.modelValue, value => {
	const next = normalizeColor(value);
	if (next.every((channel, index) => channel === color.value[index])) return;
	setColor(next, false);
}, { deep: true });

function setColor(next: RgbaColor, notify = true, source: 'hsv' | 'oklch' | null = null) {
	next = normalizeColor(next);
	if (next.slice(0, 3).some((channel, index) => channel !== color.value[index])) {
		if (source !== 'hsv') {
			const hsv = rgbToHsv(next, hue.value);
			hue.value = hsv[0];
			// 黒にした場合も彩度を保持し、明るさを戻せるようにする。
			if (hsv[2] !== 0) saturation.value = hsv[1];
			brightness.value = hsv[2];
		}
		// 入力したL・C・Hを逆変換で上書きすると、色相やchromaへ変換誤差が累積する。
		if (source !== 'oklch') oklch.value = rgbToOklch(next, oklch.value[2]);
	}
	color.value = [...next];
	if (notify) {
		changed = true;
		emit('update:modelValue', [...next]);
	}
}

function setOklch(nextOklch: [number, number, number]): boolean {
	// 無彩色の色相だけを指定した場合は、元のRGBを変換誤差も含めて保持する。
	const onlyPowerlessHueChanged = nextOklch[0] === oklch.value[0] && nextOklch[1] === 0 && oklch.value[1] === 0;
	const next = onlyPowerlessHueChanged ? [...color.value] as RgbaColor : oklchToLinearSrgb([...nextOklch, color.value[3]]);
	// 有限な入力でも逆変換の三乗がoverflowし得る。入力欄・マップのどちらも保存値へInfinityを入れない。
	if (!next.every(Number.isFinite)) return false;
	oklch.value = nextOklch;
	setColor(next, true, 'oklch');
	return true;
}

function setMapMode(mode: 'hsv' | 'oklch') {
	releaseDrag();
	// 既存の各モデルの編集値を使い、表示切替では色の再変換や更新通知を行わない。
	mapMode.value = mode;
}

function editField(event: Event, format: Format, index: number, key: string) {
	if ((event as InputEvent).isComposing) return;
	const text = (event.currentTarget as HTMLElement).textContent?.trim() ?? '';
	let next: RgbaColor | null = null;
	if (format === 'HEX') {
		next = parseColorHex(text, color.value[3]);
	} else if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
		const value = Number(text);
		let min = 0;
		let max = 1;
		if (index < 3) {
			if (format === 'Linear') {
				min = -Infinity;
				max = Infinity;
			} else if (format === 'OKLCH') {
				// LはHDR・負値も表現する。Cに色域由来の固定上限を設けず、保存RGBもclampしない。
				min = index === 0 ? -Infinity : 0;
				max = index === 2 ? 360 : Infinity;
			} else {
				max = format === 'sRGB' ? 255 : index === 0 ? 360 : 100;
			}
		}
		if (Number.isFinite(value) && value >= min && value <= max) {
			next = [...color.value];
			if (format === 'HSL' && index < 3) {
				const hsl = hsvToHsl(hue.value, saturation.value, brightness.value);
				hsl[index] = index === 0 ? value : value / 100;
				const v = hsl[2] + hsl[1] * Math.min(hsl[2], 1 - hsl[2]);
				hue.value = hsl[0];
				saturation.value = v === 0 ? 0 : 2 * (1 - hsl[2] / v);
				brightness.value = v;
				next = hsvToRgb(hue.value, saturation.value, brightness.value, color.value[3]);
			} else if (format === 'OKLCH' && index < 3) {
				const nextOklch: [number, number, number] = [...oklch.value];
				nextOklch[index] = index === 0 ? value / 100 : value;
				invalid.value = setOklch(nextOklch) ? null : key;
				return;
			} else {
				next[index] = format === 'sRGB' && index < 3 ? srgbChannelToLinear(value / 255) : value;
			}
		}
	}
	invalid.value = next != null ? null : key;
	if (next != null) setColor(next, true, format === 'HSL' ? 'hsv' : format === 'OKLCH' ? 'oklch' : null);
}

function finishEdit(event: FocusEvent, key: string) {
	editing.value = null;
	invalid.value = null;
	const field = rows.value.flatMap(row => row.fields).find(field => field.key === key)!;
	// v-textの値が変わらない場合も、未完了・不正な入力を確実に戻す。
	(event.currentTarget as HTMLElement).textContent = field.value;
	drafts.value[key] = field.value;
}

function blurEditor(event: KeyboardEvent) {
	if (!event.isComposing) (event.currentTarget as HTMLElement).blur();
}

let drag: { id: number; element: HTMLElement; kind: 'map' | 'hue' | 'alpha' } | null = null;

function startDrag(event: PointerEvent, kind: 'map' | 'hue' | 'alpha') {
	if (event.button !== 0 || drag != null) return;
	const element = event.currentTarget as HTMLElement;
	(window.document.activeElement as HTMLElement | null)?.blur();
	event.preventDefault();
	drag = { id: event.pointerId, element, kind };
	element.setPointerCapture(event.pointerId);
	moveDrag(event);
}

function moveDrag(event: PointerEvent) {
	if (drag == null || drag.id !== event.pointerId) return;
	const rect = drag.element.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return;
	const x = clampColorValue((event.clientX - rect.left) / rect.width);
	if (drag.kind === 'alpha') {
		setColor([color.value[0], color.value[1], color.value[2], x]);
	} else if (drag.kind === 'hue') {
		setMapHue(x * 360);
	} else {
		setMapPosition(x, clampColorValue((event.clientY - rect.top) / rect.height));
	}
}

function endDrag(event: PointerEvent) {
	if (drag == null || drag.id !== event.pointerId) return;
	releaseDrag();
}

function releaseDrag() {
	if (drag == null) return;
	const { element, id } = drag;
	drag = null;
	if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
}

function setMapPosition(x: number, y: number) {
	if (mapMode.value === 'oklch') {
		setOklch([1 - y, x * OKLCH_MAP_MAX_CHROMA, oklch.value[2]]);
	} else {
		saturation.value = x;
		brightness.value = 1 - y;
		setColor(hsvToRgb(hue.value, saturation.value, brightness.value, color.value[3]), true, 'hsv');
	}
}

function setMapHue(value: number) {
	if (mapMode.value === 'oklch') setOklch([oklch.value[0], oklch.value[1], value]);
	else {
		hue.value = value;
		setColor(hsvToRgb(hue.value, saturation.value, brightness.value, color.value[3]), true, 'hsv');
	}
}

function onMapKeydown(event: KeyboardEvent) {
	if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
	event.preventDefault();
	const step = event.shiftKey ? 0.1 : 0.01;
	const [x, y] = mapPosition.value;
	setMapPosition(clampColorValue(x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)), clampColorValue(y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)));
}

function onHueKeydown(event: KeyboardEvent) {
	if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
	event.preventDefault();
	const step = event.shiftKey ? 10 : 1;
	const value = event.key === 'Home' ? 0 : event.key === 'End' ? 360 : mapHue.value + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : step);
	setMapHue(Math.min(360, Math.max(0, value)));
}

function readRecent(): RgbaColor[] {
	try {
		const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
		if (!Array.isArray(stored)) return [];
		return stored.filter((value): value is RgbaColor => Array.isArray(value) && value.length === 4 && value.every(channel => typeof channel === 'number' && Number.isFinite(channel)) && value[3] >= 0 && value[3] <= 1).slice(0, 16);
	} catch {
		return [];
	}
}

function remember() {
	if (!changed) return;
	changed = false;
	// HEXで重複判定すると、表示域外の異なるHDR色が同じ白・黒として失われる。
	recent.value = [[...color.value], ...readRecent().filter(value => !value.every((channel, index) => channel === color.value[index]))].slice(0, 16) as RgbaColor[];
	try {
		localStorage.setItem(storageKey, JSON.stringify(recent.value));
	} catch {
		// ストレージが無効・容量不足でも色の編集は継続する。
	}
}

async function pickFromScreen() {
	if (!EyeDropper || picking.value) return;
	picking.value = true;
	error.value = '';
	try {
		const result = await new EyeDropper().open({ signal: eyeDropperAbort.signal });
		const next = parseColorHex(result.sRGBHex, color.value[3]);
		if (next) setColor(next);
	} catch (err) {
	} finally {
		picking.value = false;
	}
}

function onKeydown(event: KeyboardEvent) {
	if (event.key === 'Escape' && !picking.value) {
		event.preventDefault();
		close();
	}
}

onBeforeUnmount(() => {
	eyeDropperAbort.abort();
	releaseDrag();
});

function onModalClose() {
	emit('closing');
}

function onModalClosed() {
	if (!hiding.value) {
		// hidingでなければclosedを発火
		emit('closed');
	}
}

function close() {
	remember();
	manualShowing.value = false;

	// closeは呼ぶ必要がある
	modal.value?.close();
}
</script>

<style module lang="scss">
.root {
	box-sizing: border-box;
	width: 600px;
	max-width: 100vw;
	min-height: 400px;
	overflow: auto;
	padding: 14px;
	border-radius: 10px;
	outline: none;
}
.header, .actions, .sliderRow {
	display: flex;
	align-items: center;
	gap: 12px;
}
.header {
	justify-content: space-between;
	margin-bottom: 6px;
	padding-left: 4px;
}
.actions {
	gap: 6px;
}
.button {
	padding: 5px;
	border-radius: 4px;
	cursor: pointer;
	background: var(--THEME-buttonBg);
}
.button:hover {
	background: var(--THEME-buttonHoverBg);
}
.busy {
	opacity: 0.5;
	cursor: wait;
}
.body {
	display: flex;
	flex-direction: row;
	gap: 16px;
}
.leftArea {
	flex: 0.4;
	min-width: 0;
}
.rightArea {
	flex: 0.6;
	min-width: 0;
}
.mapModes {
	display: flex;
	gap: 4px;
	margin: 6px;
}
.mapMode {
	flex: 1;
	padding: 4px 8px;
	border-radius: 4px;
	background: var(--THEME-buttonBg);
	&:hover {
		background: var(--THEME-buttonHoverBg);
	}
	&.active {
		background: var(--THEME-accentedBg);
		color: var(--THEME-accent);
	}
}
.mapAxes {
	display: flex;
	justify-content: space-between;
	margin: 8px 6px 0;
	font-size: 10px;
	opacity: 0.7;
}
.map {
	position: relative;
	height: 150px;
	margin: 6px;
	cursor: crosshair;
	touch-action: none;
	user-select: none;
}
.hsvMap {
	background-image: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent);
}
.map:focus-visible, .track:focus-visible, .mapMode:focus-visible {
	outline: 2px solid var(--THEME-accent);
	outline-offset: 3px;
}
.mapHint {
	margin: 6px;
	font-size: 11px;
	line-height: 1.6;
	opacity: 0.7;
}

.thumb {
	position: absolute;
	box-sizing: border-box;
	width: 12px;
	height: 12px;
	border: 2px solid #fff;
	border-radius: 50%;
	box-shadow: 0 0 0 1px #0008;
	transform: translate(-50%, -50%);
	pointer-events: none;
}
.sliderRow {
	margin: 16px 6px;
}
.track {
	position: relative;
	flex: 1;
	height: 12px;
	border-radius: 8px;
	cursor: crosshair;
	touch-action: none;
	user-select: none;
}
.track .thumb {
	top: 50%;
}
.hsvHue {
	background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
}
.checker {
	background: repeating-conic-gradient(#888 0% 25%, #ccc 0% 50%) 0 / 10px 10px;
}
.alpha, .fill {
	width: 100%;
	height: 100%;
	border-radius: inherit;
}
.row {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-top: 8px;
}
.format {
	width: 4em;
	font-size: 90%;
	flex-shrink: 0;
}
.field {
	flex: 1;
	min-width: 0;
}
.label {
	display: block;
	font-size: 90%;
	color: color(from var(--THEME-fg) srgb r g b / 0.75);
	margin-bottom: 3px;
}
.editor {
	padding: 6px 8px;
	border-radius: 4px;
	background: var(--THEME-panel);
	white-space: pre;
	user-select: text;
	cursor: text;
	outline: none;
}
.editor:focus {
	border-color: var(--THEME-accent);
}
.editor.invalid {
	border-color: var(--THEME-error);
}
.error {
	color: var(--THEME-error);
	margin-top: 8px;
}
.recentTitle {
	margin: 0 0 8px 0;
	opacity: 0.7;
}
.recent {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}
.swatch {
	width: 28px;
	height: 24px;
	border-radius: 4px;
	border: 1px solid var(--THEME-divider);
	cursor: pointer;
}
.empty {
	opacity: 0.5;
}
</style>
