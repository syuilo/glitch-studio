<template>
<div :class="$style.root">
	<div :class="$style.label"><slot name="label"></slot></div>
	<div
		:class="[$style.input, { [$style.disabled]: disabled, [$style.focused]: editing, [$style.easing]: easing && !dragging }]"
		:style="{ anchorName: inputAnchorName }"
		data-test-range-control
		@pointerdown="onPointerdown"
		@dblclick.stop="beginEditing"
	>
		<div :class="$style.fill" :style="{ width: `${valueRatio * 100}%` }" data-test-range-fill></div>
		<div :class="$style.prefix"><slot name="prefix"></slot></div>
		<input
			v-if="editing"
			ref="inputEl"
			v-model="draft"
			:class="$style.nativeInput"
			type="text"
			:spellcheck="false"
			:disabled="disabled"
			data-test-range-editor
			@keydown="onEditorKeydown"
		>
		<div v-else :class="$style.value" data-test-range-value>{{ formatValue(value) }}</div>
		<div :class="$style.suffix"><slot name="suffix"></slot></div>
	</div>
	<div :class="$style.caption"><slot name="caption"></slot></div>
	<Teleport to="body">
		<div
			v-if="editing"
			:class="$style.manualSaveActions"
			class="_popup _shadow"
			:style="{ positionAnchor: inputAnchorName, zIndex: manualSaveActionsZIndex }"
		>
			<GsButton iconOnly data-test-range-save small primary :disabled="disabled || !draftHasContent" icon="ti ti-check" @click="saveEditing"/>
			<GsButton iconOnly data-test-range-cancel small :disabled="disabled" icon="ti ti-x" @click="cancelEditing"/>
		</div>
	</Teleport>
</div>
</template>

<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import { genId } from '@gs/shared/utility/id.ts';
import GsButton from '@/components/common/GsButton.vue';
import { listenPointerDrag } from '@/utility/pointer-drag.ts';
import { evaluateNumericInputExpression } from '@/utility/numeric-input-expression.ts';
import * as ui from '@/ui.ts';

const props = withDefaults(defineProps<{
	modelValue: number;
	disabled?: boolean;
	min: number;
	max: number;
	step?: number;
	logarithmic?: boolean;
	textConverter?: (value: number) => string;
	easing?: boolean;
	continuousUpdate?: boolean;
}>(), {
	step: 1,
	easing: false,
});

const emit = defineEmits<{
	(ev: 'update:modelValue', value: number): void;
	(ev: 'beginChanging'): void;
	(ev: 'changeFinished'): void;
	(ev: 'dragEnded', value: number): void;
}>();

const inputEl = useTemplateRef('inputEl');
const inputAnchorName = `--gs-range-${genId()}`;
const manualSaveActionsZIndex = ui.claimZIndex('high');
const value = ref(props.modelValue);
const editing = ref(false);
const dragging = ref(false);
// 直接入力はドラフトとして保持し、blurや入力イベントから親へ通知しない。
// min/maxとstepはドラッグ専用の制約であり、確定した直接入力には適用しない。
const draft = ref<string | number>('');
const draftHasContent = computed(() => String(draft.value).trim() !== '');
const useLogarithmic = computed(() => props.logarithmic === true && props.min > 0 && props.max > props.min);
let finishDrag: (() => void) | null = null;

function clampValue(current: number): number {
	return Math.min(props.max, Math.max(props.min, current));
}

function calcValueRatio(current: number): number {
	if (props.max <= props.min) return 0;
	const clamped = clampValue(current);
	return useLogarithmic.value
		? Math.log(clamped / props.min) / Math.log(props.max / props.min)
		: (clamped - props.min) / (props.max - props.min);
}

const valueRatio = computed(() => calcValueRatio(value.value));

function formatValue(current: number): string {
	if (props.textConverter != null) return props.textConverter(current);
	// Shift調整や小さい値も表示できるよう、固定の小数桁数で切り捨てない。
	return Number(current.toPrecision(10)).toString();
}

function onPointerdown(event: PointerEvent) {
	if (props.disabled || editing.value || finishDrag != null || event.button !== 0 || !event.isPrimary || props.max <= props.min) return;
	const controlWidth = (event.currentTarget as HTMLElement).getBoundingClientRect().width;
	if (controlWidth <= 0) return;
	event.preventDefault();
	event.stopPropagation();
	const beforeValue = value.value;
	let previousX = event.clientX;
	let precisionMode = event.shiftKey;
	let ratio = calcValueRatio(value.value);
	let segmentStartValue = clampValue(value.value);
	dragging.value = true;
	emit('beginChanging');

	finishDrag = listenPointerDrag(event, current => {
		if (props.disabled) return;
		const deltaX = current.clientX - previousX;
		previousX = current.clientX;
		if (deltaX === 0) return;
		if (precisionMode !== current.shiftKey) {
			// Shift切り替えで過去の移動量を再計算すると値が跳ぶため、現在値を新しい基準にする。
			precisionMode = current.shiftKey;
			ratio = calcValueRatio(value.value);
			segmentStartValue = clampValue(value.value);
		}
		// clientXと同じ表示上の幅を使い、帯の端とポインターの移動距離を揃える。
		// 途中で感度が変わらないよう幅は開始時に固定し、Shift中だけ移動量を1/10にする。
		ratio = Math.min(1, Math.max(0, ratio + deltaX / controlWidth * (precisionMode ? 0.1 : 1)));
		let nextValue: number;
		if (useLogarithmic.value) {
			// 小さな値を固定stepで失わないよう、従来どおり対数操作は連続値を使う。
			nextValue = props.min * (props.max / props.min) ** ratio;
		} else {
			nextValue = props.min + ratio * (props.max - props.min);
			const step = props.step * (precisionMode ? 0.1 : 1);
			if (step > 0 && ratio > 0 && ratio < 1) {
				// 直接入力やShift調整でstepの倍数から外れていても、操作開始時の値を保持する。
				nextValue = segmentStartValue + Math.round((nextValue - segmentStartValue) / step) * step;
			}
		}
		// 小数stepの浮動小数点誤差を除き、丸め後も必ずドラッグの上下限を守る。
		nextValue = clampValue(Number(nextValue.toPrecision(15)));
		if (nextValue === value.value) return;
		value.value = nextValue;
		if (props.continuousUpdate) emit('update:modelValue', nextValue);
	}, () => {
		finishDrag = null;
		dragging.value = false;
		if (beforeValue !== value.value) {
			if (!props.continuousUpdate) emit('update:modelValue', value.value);
			emit('dragEnded', value.value);
		}
		emit('changeFinished');
	});
}

async function beginEditing() {
	if (props.disabled || editing.value) return;
	finishDrag?.();
	draft.value = value.value;
	editing.value = true;
	await nextTick();
	inputEl.value?.focus();
	inputEl.value?.select();
}

function saveEditing() {
	if (props.disabled || !editing.value || !draftHasContent.value) return;
	// 入力中は評価せず、明示的な確定時だけ式を数値へ置き換える。
	// 失敗時は編集状態と入力内容を維持し、途中の式や不正な値を親へ送らない。
	const nextValue = evaluateNumericInputExpression(draft.value);
	if (nextValue == null) return;
	editing.value = false;
	if (nextValue === value.value) return;
	// 直接入力もドラッグと同じ編集境界で通知し、呼び出し元のUndo/Redoにまとめる。
	emit('beginChanging');
	value.value = nextValue;
	emit('update:modelValue', nextValue);
	emit('changeFinished');
}

function cancelEditing() {
	editing.value = false;
	draft.value = value.value;
}

function onEditorKeydown(event: KeyboardEvent) {
	if (event.isComposing || event.key === 'Process' || event.keyCode === 229 || event.altKey || event.shiftKey) return;
	if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey) {
		event.preventDefault();
		event.stopPropagation();
		cancelEditing();
	} else if (event.key === 'Enter' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's')) {
		event.preventDefault();
		event.stopPropagation();
		if (!event.repeat) saveEditing();
	}
}

watch(() => props.modelValue, newValue => {
	value.value = newValue;
	// Undo/Redoや外部操作後に古いドラフトを確定させない。同期自体は編集として通知しない。
	if (editing.value) draft.value = newValue;
});

watch(() => props.disabled, disabled => {
	if (!disabled) return;
	finishDrag?.();
	cancelEditing();
});

onBeforeUnmount(() => finishDrag?.());
</script>

<style lang="scss" module>
.root {
	--height: var(--GS-CONTROL-HEIGHT);
}

.label {
	font-size: 90%;
	padding: 0 0 4px 0;
	user-select: none;

	&:empty {
		display: none;
	}
}

.caption {
	font-size: 90%;
	padding: 4px 0 0 0;
	color: color(from var(--THEME-fg) srgb r g b / 0.75);

	&:empty {
		display: none;
	}
}

.input {
	position: relative;
	box-sizing: border-box;
	height: var(--height);
	background: var(--THEME-input);
	border-radius: 6px;
	overflow: clip;
	cursor: ew-resize;
	touch-action: none;
	user-select: none;

	&:hover {
		background: hsl(from var(--THEME-input) h s calc(l + 5));
	}

	&.focused {
		box-shadow: 0 0 0 1px var(--THEME-accent);
		cursor: text;
		touch-action: auto;
		user-select: text;
	}

	&.disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}
}

.fill {
	position: absolute;
	inset: 0 auto 0 0;
	background: color(from var(--THEME-accent) srgb r g b / 0.25);
	pointer-events: none;
}

.easing .fill {
	transition: width 0.2s cubic-bezier(0, 0, 0, 1);
}

.value,
.nativeInput {
	position: relative;
	display: block;
	box-sizing: border-box;
	width: 100%;
	height: 100%;
	margin: 0;
	padding: 0 10px;
	font: inherit;
	font-weight: normal;
	font-size: 1em;
	text-align: center;
	font-variant-numeric: tabular-nums;
	color: var(--THEME-fg);
}

.value {
	line-height: var(--height);
	white-space: nowrap;
	overflow: clip;
	text-overflow: ellipsis;
	pointer-events: none;
}

.nativeInput {
	appearance: none;
	background: transparent;
	border: none;
	border-radius: 0;
	outline: none;
	box-shadow: none;
}

.prefix,
.suffix {
	display: flex;
	align-items: center;
	position: absolute;
	z-index: 1;
	top: 0;
	height: var(--height);
	padding: 0 8px;
	color: color(from var(--THEME-fg) srgb r g b / 0.7);
	pointer-events: none;

	&:empty {
		display: none;
	}
}

.prefix {
	left: 0;
}

.suffix {
	right: 0;
}

.manualSaveActions {
	position: fixed;
	top: anchor(bottom);
	left: anchor(left);
	display: flex;
	gap: 6px;
	padding: 6px;
	border-radius: 0 0 5px 5px;
	box-sizing: border-box;
}
</style>
