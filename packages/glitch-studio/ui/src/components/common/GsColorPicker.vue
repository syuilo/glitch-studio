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
			<b>{{ title ?? 'Color' }}</b>
			<div :class="$style.actions">
				<div v-if="EyeDropper" :class="[$style.button, { [$style.busy]: picking }]" title="画面から色を取得" tabindex="0" @click="pickFromScreen" @keydown.enter.prevent="pickFromScreen"><i class="ti ti-color-picker"></i></div>
				<div :class="$style.button" title="閉じる" tabindex="0" @click="close" @keydown.enter.prevent="close"><i class="ti ti-x"></i></div>
			</div>
		</div>
		<div :class="$style.body">
			<div :class="$style.leftArea">
				<div :class="$style.map" :style="{ backgroundColor: `hsl(${hue} 100% 50%)` }" @pointerdown="startDrag($event, 'map')" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag">
					<div :class="$style.thumb" :style="{ left: `${saturation * 100}%`, top: `${(1 - brightness) * 100}%`, background: colorCss(color) }"></div>
				</div>
				<div :class="$style.sliderRow">
					<div :class="[$style.track, $style.hue]" @pointerdown="startDrag($event, 'hue')" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag">
						<div :class="$style.thumb" :style="{ left: `${hue / 360 * 100}%` }"></div>
					</div>
				</div>
				<div :class="$style.sliderRow">
					<div :class="[$style.track, $style.checker]" @pointerdown="startDrag($event, 'alpha')" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag">
						<div :class="$style.alpha" :style="{ background: `linear-gradient(to right, ${colorCss([color[0], color[1], color[2], 0])}, ${colorCss([color[0], color[1], color[2], 1])})` }"></div>
						<div :class="$style.thumb" :style="{ left: `${color[3] * 100}%` }"></div>
					</div>
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
							contenteditable="plaintext-only" :spellcheck="false" :inputmode="row.name === 'HEX' ? 'text' : 'decimal'"
							@focus="editing = field.key" @input="editField($event, row.name, field.index, field.key)"
							@blur="finishEdit($event, field.key)" @keydown.enter.prevent="blurEditor" @keydown.esc.stop.prevent="blurEditor"
							v-text="drafts[field.key]"
						></div>
					</div>
				</div>
				<div v-if="error" :class="$style.error">{{ error }}</div>
			</div>
		</div>
		<div :class="$style.recentTitle">Recent colors</div>
		<div :class="$style.recent">
			<div v-for="(recentColor, index) in recent" :key="index" :class="[$style.swatch, $style.checker]" :title="colorHex(recentColor)" tabindex="0" @click="setColor(recentColor)" @keydown.enter.prevent="setColor(recentColor)">
				<div :class="$style.fill" :style="{ background: colorCss(recentColor) }"></div>
			</div>
			<span v-if="recent.length === 0" :class="$style.empty">まだありません</span>
		</div>
	</div>
</GsModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import type { RgbaColor } from '@/utility/color-input.ts';
import { clampColorValue, colorCss, colorHex, hsvToHsl, hsvToRgb, normalizeColor, parseColorHex, rgbToHsv } from '@/utility/color-input.ts';
import GsModal from '@/components/common/GsModal.vue';
import * as ui from '@/ui.ts';

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

type Format = 'RGB' | 'HSL' | 'HEX' | '0~1';
const rows = computed(() => {
	const hsl = hsvToHsl(hue.value, saturation.value, brightness.value);
	const definitions: { name: Format; labels: string[]; values: (string | number)[] }[] = [
		{ name: 'RGB', labels: ['R', 'G', 'B', 'A'], values: [...color.value.slice(0, 3).map(v => Math.round(v * 255)), color.value[3]] },
		{ name: 'HSL', labels: ['H°', 'S%', 'L%', 'A'], values: [hsl[0], hsl[1] * 100, hsl[2] * 100, color.value[3]] },
		{ name: 'HEX', labels: ['#RRGGBBAA'], values: [colorHex(color.value)] },
		{ name: '0~1', labels: ['R', 'G', 'B', 'A'], values: color.value },
	];
	return definitions.map(row => ({
		name: row.name,
		fields: row.values.map((value, index) => ({ key: `${row.name}-${index}`, index, label: row.labels[index], value: typeof value === 'number' ? String(Number(value.toFixed(4))) : value })),
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

function setColor(next: RgbaColor, notify = true, updateHsv = true) {
	next = normalizeColor(next);
	if (updateHsv && next.slice(0, 3).some((channel, index) => channel !== color.value[index])) {
		const hsv = rgbToHsv(next, hue.value);
		hue.value = hsv[0];
		// 黒にした場合も彩度を保持し、明るさを戻せるようにする。
		if (hsv[2] !== 0) saturation.value = hsv[1];
		brightness.value = hsv[2];
	}
	color.value = [...next];
	if (notify) {
		changed = true;
		emit('update:modelValue', [...next]);
	}
}

function editField(event: Event, format: Format, index: number, key: string) {
	if ((event as InputEvent).isComposing) return;
	const text = (event.currentTarget as HTMLElement).textContent?.trim() ?? '';
	let next: RgbaColor | null = null;
	if (format === 'HEX') {
		next = parseColorHex(text, color.value[3]);
	} else if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
		const value = Number(text);
		const max = index === 3 || format === '0~1' ? 1 : format === 'RGB' ? 255 : index === 0 ? 360 : 100;
		if (Number.isFinite(value) && value >= 0 && value <= max) {
			next = [...color.value];
			if (format === 'HSL' && index < 3) {
				const hsl = hsvToHsl(hue.value, saturation.value, brightness.value);
				hsl[index] = index === 0 ? value : value / 100;
				const v = hsl[2] + hsl[1] * Math.min(hsl[2], 1 - hsl[2]);
				hue.value = hsl[0];
				saturation.value = v === 0 ? 0 : 2 * (1 - hsl[2] / v);
				brightness.value = v;
				next = hsvToRgb(hue.value, saturation.value, brightness.value, color.value[3]);
			} else {
				next[index] = value / max;
			}
		}
	}
	invalid.value = next ? null : key;
	if (next) setColor(next, true, format !== 'HSL');
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
	if (event.button !== 0 || drag) return;
	const element = event.currentTarget as HTMLElement;
	(window.document.activeElement as HTMLElement | null)?.blur();
	event.preventDefault();
	drag = { id: event.pointerId, element, kind };
	element.setPointerCapture(event.pointerId);
	moveDrag(event);
}

function moveDrag(event: PointerEvent) {
	if (!drag || drag.id !== event.pointerId) return;
	const rect = drag.element.getBoundingClientRect();
	const x = clampColorValue((event.clientX - rect.left) / rect.width);
	if (drag.kind === 'alpha') {
		setColor([color.value[0], color.value[1], color.value[2], x], true, false);
	} else {
		if (drag.kind === 'hue') hue.value = x * 360;
		else {
			saturation.value = x;
			brightness.value = 1 - clampColorValue((event.clientY - rect.top) / rect.height);
		}
		setColor(hsvToRgb(hue.value, saturation.value, brightness.value, color.value[3]), true, false);
	}
}

function endDrag(event: PointerEvent) {
	if (!drag || drag.id !== event.pointerId) return;
	const { element, id } = drag;
	drag = null;
	if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
}

function readRecent(): RgbaColor[] {
	try {
		const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
		if (!Array.isArray(stored)) return [];
		return stored.filter((value): value is RgbaColor => Array.isArray(value) && value.length === 4 && value.every(channel => typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 1)).slice(0, 16);
	} catch {
		return [];
	}
}

function remember() {
	if (!changed) return;
	changed = false;
	const key = colorHex(color.value);
	recent.value = [[...color.value], ...readRecent().filter(value => colorHex(value) !== key)].slice(0, 16) as RgbaColor[];
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

let rafId = 0;

onBeforeUnmount(() => {
	eyeDropperAbort.abort();
	cancelAnimationFrame(rafId);
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
	height: 350px;
	overflow: auto;
	padding: 14px;
	border-radius: 10px;
	font-size: 12px;
	outline: none;
}
.header, .actions, .sliderRow { display: flex; align-items: center; gap: 12px; }
.header { justify-content: space-between; margin-bottom: 6px; padding-left: 4px; }
.actions { gap: 6px; }
.button { padding: 5px; border-radius: 4px; cursor: pointer; background: var(--THEME-buttonBg); }
.button:hover { background: var(--THEME-buttonHoverBg); }
.busy { opacity: 0.5; cursor: wait; }
.body {
	display: flex;
	flex-direction: row;
	gap: 16px;
}
.leftArea {
	flex: 0.4;
}
.rightArea {
	flex: 0.6;
}
.map {
	position: relative;
	height: 150px;
	margin: 6px;
	background-image: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent);
	cursor: crosshair;
	touch-action: none;
	user-select: none;
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
.sliderRow { margin: 16px 6px; }
.track { position: relative; flex: 1; height: 12px; border-radius: 8px; cursor: crosshair; touch-action: none; user-select: none; }
.track .thumb { top: 50%; }
.hue { background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
.checker { background: repeating-conic-gradient(#888 0% 25%, #ccc 0% 50%) 0 / 10px 10px; }
.alpha, .fill { width: 100%; height: 100%; border-radius: inherit; }
.row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.format { width: 30px; flex-shrink: 0; font-size: 11px; }
.field { flex: 1; min-width: 0; }
.label { display: block; font-size: 10px; opacity: 0.6; margin-bottom: 3px; }
.editor {
	padding: 6px 8px;
	border-radius: 4px;
	background: var(--THEME-panel);
	white-space: pre;
	user-select: text;
	cursor: text;
	outline: none;
}
.editor:focus { border-color: var(--THEME-accent); }
.editor.invalid { border-color: var(--THEME-error); }
.error { color: var(--THEME-error); margin-top: 8px; }
.recentTitle { margin: 0 0 8px 0; opacity: 0.7; }
.recent { display: flex; flex-wrap: wrap; gap: 6px; }
.swatch { width: 28px; height: 24px; border-radius: 4px; border: 1px solid var(--THEME-divider); cursor: pointer; }
.empty { opacity: 0.5; }
</style>
