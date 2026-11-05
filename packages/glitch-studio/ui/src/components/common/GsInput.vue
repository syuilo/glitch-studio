<template>
<div class="_selectable" :class="[$style.root, { [$style.small]: small, [$style.large]: large }]">
	<div :class="$style.label" @click="focus"><slot name="label"></slot></div>
	<div :class="[$style.input, { [$style.inline]: inline, [$style.disabled]: disabled, [$style.focused]: focused }]" :style="{ anchorName: inputAnchorName }">
		<div :class="$style.nativeInputWrapper">
			<div ref="prefixEl" :class="$style.prefix"><slot name="prefix"></slot></div>
			<input
				ref="inputEl"
				v-model="v"
				:class="[$style.nativeInput, { '_monospace': monospace }]"
				:type="inputType"
				:disabled="disabled"
				:required="required"
				:readonly="readonly"
				:placeholder="placeholder"
				:pattern="pattern"
				:autocomplete="autocomplete"
				:autocapitalize="autocapitalize"
				:spellcheck="spellcheck"
				:inputmode="inputmode"
				:step="step"
				:list="id"
				:min="min"
				:max="max"
				@focus="focused = true"
				@blur="focused = false"
				@keydown="onKeydown($event)"
				@input="onInput"
			>
			<datalist v-if="datalist" :id="id">
				<option v-for="data in datalist" :key="data" :value="data"></option>
			</datalist>
			<div ref="suffixEl" :class="$style.suffix"><slot name="suffix"></slot></div>
		</div>
		<div :class="$style.stepper"><i class="ti ti-caret-up-down"></i></div>
	</div>
	<div :class="$style.caption"><slot name="caption" :value="v"></slot></div>

	<Teleport to="body">
		<div v-if="manualSave && changed" :class="$style.manualSaveActions" class="_popup _shadow" :style="{ positionAnchor: inputAnchorName, zIndex: manualSaveActionsZIndex }">
			<GsButton iconOnly data-test-input-save small primary :disabled="disabled || readonly" icon="ti ti-check" @click="updated"></GsButton>
			<GsButton iconOnly data-test-input-cancel small :disabled="disabled || readonly" icon="ti ti-x" @click="cancelEditing"></GsButton>
		</div>
	</Teleport>
</div>
</template>

<script lang="ts">
type SupportedTypes = 'text' | 'password' | 'email' | 'url' | 'tel' | 'number' | 'search' | 'date' | 'time' | 'datetime-local' | 'color';
type ModelValueType<T extends SupportedTypes> =
	T extends 'number' ? number :
	T extends 'text' | 'password' | 'email' | 'url' | 'tel' | 'search' | 'date' | 'time' | 'datetime-local' | 'color' ? string :
	never;
</script>

<script lang="ts" setup generic="T extends SupportedTypes = 'text'">
import { onMounted, onUnmounted, nextTick, ref, useTemplateRef, watch, computed, toRefs } from 'vue';
import { throttle, debounce } from 'throttle-debounce';
import * as AiScript from '@syuilo/aiscript';
import { genId } from '@gs/shared/utility/id.ts';
import type { InputHTMLAttributes } from 'vue';
import type { SuggestionType } from '@/utility/autocomplete.ts';
import GsButton from '@/components/common/GsButton.vue';
import { i18n } from '@/i18n.ts';
import { Autocomplete } from '@/utility/autocomplete.ts';
import * as ui from '@/ui.ts';

const props = withDefaults(defineProps<{
	modelValue: ModelValueType<T> | null;
	type?: T;
	required?: boolean;
	readonly?: boolean;
	disabled?: boolean;
	pattern?: string;
	placeholder?: string;
	autofocus?: boolean;
	autocomplete?: string;
	autocapitalize?: string;
	spellcheck?: boolean;
	inputmode?: InputHTMLAttributes['inputmode'];
	step?: InputHTMLAttributes['step'];
	datalist?: string[];
	min?: number;
	max?: number;
	inline?: boolean;
	debounce?: boolean | number;
	throttle?: boolean | number;
	manualSave?: boolean;
	allowExpression?: boolean;
	small?: boolean;
	large?: boolean;
	monospace?: boolean;
}>(), {
	allowExpression: true,
});

const emit = defineEmits<{
	(ev: 'change', _ev: InputEvent): void;
	(ev: 'keydown', _ev: KeyboardEvent): void;
	(ev: 'enter', _ev: KeyboardEvent): void;
	(ev: 'update:modelValue', value: ModelValueType<T>): void;
	(ev: 'savingStateChange', saved: boolean, invalid: boolean): void;
}>();

const { modelValue } = toRefs(props);
// 数値のmodelValueとは別に、確定前の式もドラフトとして保持する。
const v = ref<string | number | null>(modelValue.value);
const expressionEnabled = computed(() => props.type === 'number' && props.allowExpression && props.manualSave === true);
const inputType = computed(() => expressionEnabled.value ? 'text' : props.type);
const expressionParser = new AiScript.Parser();
const id = genId();
// Teleport先ではコンポーネント内のスコープを共有できないため、入力欄ごとに名前を分ける。
const inputAnchorName = `--gs-input-${id}`;
const manualSaveActionsZIndex = ui.claimZIndex('high');
const focused = ref(false);
const changed = ref(false);
const invalid = ref(false);
const filled = computed(() => v.value !== '' && v.value != null);
const inputEl = useTemplateRef('inputEl');
const prefixEl = useTemplateRef('prefixEl');
const suffixEl = useTemplateRef('suffixEl');
let autocompleteWorker: Autocomplete | null = null;

const focus = () => inputEl.value?.focus();
const onInput = (event: InputEvent) => {
	changed.value = true;
	emit('change', event);
};
const onKeydown = (ev: KeyboardEvent) => {
	if (ev.isComposing || ev.key === 'Process' || ev.keyCode === 229) return;

	// Escは編集中のドラフトだけを破棄する。IMEの取消しや親画面の閉じる操作と区別する。
	if (props.manualSave && !props.disabled && !props.readonly && changed.value && ev.key === 'Escape'
		&& !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey) {
		ev.preventDefault();
		ev.stopPropagation();
		cancelEditing();
		return;
	}

	// 手動保存ではEnterまたは保存ショートカットでドラフトを確定する。
	// 親画面の操作やフォーム送信も同時に実行されないよう、保存操作をここで消費する。
	// IME変換の確定は冒頭で除外し、日本語入力の途中で値を適用しない。
	if (props.manualSave && !props.disabled && !props.readonly && !ev.altKey && !ev.shiftKey
		&& (ev.key === 'Enter' || ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's'))) {
		ev.preventDefault();
		ev.stopPropagation();
		if (!ev.repeat) updated();
		return;
	}

	emit('keydown', ev);

	if (ev.code === 'Enter') {
		emit('enter', ev);
	}
};

const updated = () => {
	if (expressionEnabled.value) {
		try {
			const ast = expressionParser.parse(String(v.value ?? ''));
			// 前回確定した式の変数や実行状態を引き継がず、数値欄内だけで評価を完結させる。
			const interpreter = new AiScript.Interpreter({});
			const result = interpreter.execSync(ast);
			// 数値欄には有限の数値だけを適用し、文字列やnullを暗黙に数値へ変換しない。
			if (result == null || result.type !== 'num' || !Number.isFinite(result.value)) {
				invalid.value = true;
				return;
			}
			v.value = result.value;
			invalid.value = false;
		} catch {
			// 入力を残して修正できるよう、失敗時は未保存状態も維持する。
			invalid.value = true;
			return;
		}
	}
	changed.value = false;
	// Undo/Redoなどで親から同期された値を編集として返すと、Redo履歴が消えてしまう。
	if (Object.is(v.value, modelValue.value)) return;
	if (props.type === 'number') {
		emit('update:modelValue', typeof v.value === 'number' ? v.value as ModelValueType<T> : parseFloat(v.value ?? '0') as ModelValueType<T>);
	} else {
		emit('update:modelValue', (v.value ?? '') as ModelValueType<T>);
	}
};

const throttledUpdated = throttle(typeof props.throttle === 'number' ? props.throttle : 1000, updated);
const debouncedUpdated = debounce(typeof props.debounce === 'number' ? props.debounce : 1000, updated);

function cancelEditing() {
	// 破棄した入力を後から遅延通知せず、現在の適用済み値へローカルだけを戻す。
	throttledUpdated.cancel({ upcomingOnly: true });
	debouncedUpdated.cancel({ upcomingOnly: true });
	v.value = modelValue.value;
	changed.value = false;
	focus();
}

watch(modelValue, newValue => {
	// 外部から値が確定した後に、以前の入力の遅延通知を発行しない。
	throttledUpdated.cancel({ upcomingOnly: true });
	debouncedUpdated.cancel({ upcomingOnly: true });
	changed.value = false;
	v.value = newValue;
});

// 式を評価結果に置き換えた変更もupdated内で同期的に処理し、その後の未保存解除を上書きしない。
watch(v, () => {
	if (props.manualSave) {
		changed.value = !Object.is(v.value, modelValue.value);
	} else if (!Object.is(v.value, modelValue.value)) {
		if (props.throttle === true || typeof props.throttle === 'number') {
			throttledUpdated();
		} else if (props.debounce === true || typeof props.debounce === 'number') {
			debouncedUpdated();
		} else {
			updated();
		}
	}

	invalid.value = inputEl.value?.validity.badInput ?? true;
}, { flush: 'sync' });

watch([changed, invalid], ([newChanged, newInvalid]) => {
	emit('savingStateChange', newChanged, newInvalid);
}, { immediate: true });

// このコンポーネントが作成された時、非表示状態である場合がある
// 非表示状態だと要素の幅などは0になってしまうので、ResizeObserverでサイズの変化を監視して計算する
const updatePadding = (entries: ResizeObserverEntry[]) => {
	if (inputEl.value == null) return;

	for (const entry of entries) {
		const width = entry.borderBoxSize[0].inlineSize;
		if (width === 0) continue;
		if (entry.target === prefixEl.value) {
			inputEl.value.style.paddingLeft = width + 'px';
		} else if (entry.target === suffixEl.value) {
			inputEl.value.style.paddingRight = width + 'px';
		}
	}
};

let paddingObserver: ResizeObserver | null = null;

onMounted(() => {
	paddingObserver = new ResizeObserver(updatePadding);
	if (prefixEl.value) paddingObserver.observe(prefixEl.value);
	if (suffixEl.value) paddingObserver.observe(suffixEl.value);

	nextTick(() => {
		if (props.autofocus) {
			focus();
		}
	});

	if (props.autocomplete && inputEl.value) {
		autocompleteWorker = new Autocomplete(inputEl.value, v);
	}
});

onUnmounted(() => {
	throttledUpdated.cancel({ upcomingOnly: true });
	debouncedUpdated.cancel({ upcomingOnly: true });
	paddingObserver?.disconnect();
	paddingObserver = null;

	if (autocompleteWorker) {
		autocompleteWorker.detach();
	}
});

defineExpose({
	focus,
});
</script>

<style lang="scss" module>
.root {
	--height: var(--GS-CONTROL-HEIGHT);

	&.small {
		--height: var(--GS-CONTROL-HEIGHT-SMALL);
	}

	&.large {
		--height: var(--GS-CONTROL-HEIGHT-LARGE);
	}
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
	display: flex;
	box-sizing: border-box;
	height: var(--height);
	background: var(--THEME-input);
	border-radius: 6px;

	&.inline {
		display: inline-block;
		margin: 0;
	}

	&.focused {
		box-shadow: 0 0 0 1px var(--THEME-accent);
	}

	&.disabled {
		opacity: 0.7;

		&,
		> .nativeInput {
			cursor: not-allowed !important;
		}
	}

	&:hover {
		background: hsl(from var(--THEME-input) h s calc(l + 5));
	}
}

.nativeInputWrapper {
	position: relative;
	flex: 1;
	min-width: 0;
}

.nativeInput {
	appearance: none;
	-webkit-appearance: none;
	display: block;
	height: 100%;
	width: 100%;
	margin: 0;
	padding: 0 10px;
	font: inherit;
	font-weight: normal;
	font-size: 1em;
	color: var(--THEME-fg);
	background: transparent;
	border: none;
	border-radius: 0;
	outline: none;
	box-shadow: none;
	box-sizing: border-box;
}

.prefix,
.suffix {
	display: flex;
	align-items: center;
	position: absolute;
	z-index: 1;
	top: 0;
	padding: 0 8px;
	height: var(--height);
	min-width: 16px;
	max-width: 150px;
	overflow: clip;
	white-space: nowrap;
	text-overflow: ellipsis;
	box-sizing: border-box;
	color: color(from var(--THEME-fg) srgb r g b / 0.7);
	pointer-events: none;

	&:empty {
		display: none;
	}
}

.prefix {
	left: 0;
	padding-right: 5px;
}

.suffix {
	right: 0;
	padding-left: 5px;
}

.stepper {
	height: var(--height);
	width: var(--height);
	display: grid;
	place-content: center;
	cursor: ns-resize;
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
