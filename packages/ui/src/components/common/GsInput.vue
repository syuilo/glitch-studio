<template>
<div class="_selectable">
	<div :class="$style.label" @click="focus"><slot name="label"></slot></div>
	<div :class="[$style.input, { [$style.inline]: inline, [$style.disabled]: disabled, [$style.focused]: focused }]">
		<div ref="prefixEl" :class="$style.prefix"><slot name="prefix"></slot></div>
		<input
			ref="inputEl"
			v-model="v"
			:class="$style.inputCore"
			:type="type"
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
	<div :class="$style.caption"><slot name="caption"></slot></div>

	<GsButton v-if="manualSave && changed" primary :class="$style.save" @click="updated"><i class="ti ti-check"></i></GsButton>
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
import { genId } from '@glitch/shared/utility/id.ts';
import type { InputHTMLAttributes } from 'vue';
import type { SuggestionType } from '@/utility/autocomplete.ts';
import GsButton from '@/components/common/GsButton.vue';
import { i18n } from '@/i18n.ts';
import { Autocomplete } from '@/utility/autocomplete.ts';

const props = defineProps<{
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
	small?: boolean;
	large?: boolean;
}>();

const emit = defineEmits<{
	(ev: 'change', _ev: InputEvent): void;
	(ev: 'keydown', _ev: KeyboardEvent): void;
	(ev: 'enter', _ev: KeyboardEvent): void;
	(ev: 'update:modelValue', value: ModelValueType<T>): void;
	(ev: 'savingStateChange', saved: boolean, invalid: boolean): void;
}>();

const { modelValue } = toRefs(props);
const v = ref<ModelValueType<T> | null>(modelValue.value);
const id = genId();
const focused = ref(false);
const changed = ref(false);
const invalid = ref(false);
const filled = computed(() => v.value !== '' && v.value != null);
const inputEl = useTemplateRef('inputEl');
const prefixEl = useTemplateRef('prefixEl');
const suffixEl = useTemplateRef('suffixEl');
const height =
	props.small ? 26 :
	props.large ? 30 :
	28;
let autocompleteWorker: Autocomplete | null = null;

const focus = () => inputEl.value?.focus();
const onInput = (event: InputEvent) => {
	changed.value = true;
	emit('change', event);
};
const onKeydown = (ev: KeyboardEvent) => {
	if (ev.isComposing || ev.key === 'Process' || ev.keyCode === 229) return;

	emit('keydown', ev);

	if (ev.code === 'Enter') {
		emit('enter', ev);
	}
};

const updated = () => {
	changed.value = false;
	// Undo/Redoなどで親から同期された値を編集として返すと、Redo履歴が消えてしまう。
	if (Object.is(v.value, modelValue.value)) return;
	if (props.type === 'number') {
		emit('update:modelValue', typeof v.value === 'number' ? v.value as ModelValueType<T> : parseFloat(v.value ?? '0') as ModelValueType<T>);
	} else {
		emit('update:modelValue', v.value ?? '');
	}
};

const throttledUpdated = throttle(typeof props.throttle === 'number' ? props.throttle : 1000, updated);
const debouncedUpdated = debounce(typeof props.debounce === 'number' ? props.debounce : 1000, updated);

watch(modelValue, newValue => {
	// 外部から値が確定した後に、以前の入力の遅延通知を発行しない。
	throttledUpdated.cancel({ upcomingOnly: true });
	debouncedUpdated.cancel({ upcomingOnly: true });
	v.value = newValue;
});

watch(v, () => {
	if (!props.manualSave && !Object.is(v.value, modelValue.value)) {
		if (props.throttle === true || typeof props.throttle === 'number') {
			throttledUpdated();
		} else if (props.debounce === true || typeof props.debounce === 'number') {
			debouncedUpdated();
		} else {
			updated();
		}
	}

	invalid.value = inputEl.value?.validity.badInput ?? true;
});

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
.label {
	font-size: 0.85em;
	padding: 0 0 4px 0;
	user-select: none;

	&:empty {
		display: none;
	}
}

.caption {
	font-size: 0.85em;
	padding: 4px 0 0 0;
	color: color(from var(--THEME-fg) srgb r g b / 0.75);

	&:empty {
		display: none;
	}
}

.input {
	position: relative;

	&.inline {
		display: inline-block;
		margin: 0;
	}

	&.focused {
		> .inputCore {
			border-color: var(--THEME-accent) !important;
			//box-shadow: 0 0 0 4px var(--THEME-focus);
		}
	}

	&.disabled {
		opacity: 0.7;

		&,
		> .inputCore {
			cursor: not-allowed !important;
		}
	}
}

.inputCore {
	appearance: none;
	-webkit-appearance: none;
	display: block;
	height: v-bind("height + 'px'");
	width: 100%;
	margin: 0;
	padding: 0 10px;
	font: inherit;
	font-weight: normal;
	font-size: 1em;
	color: var(--THEME-fg);
	background: var(--THEME-panel);
	border: solid 1px var(--THEME-panel);
	border-radius: 6px;
	outline: none;
	box-shadow: none;
	box-sizing: border-box;
	transition: border-color 0.1s ease-out;

	&:hover {
		background: hsl(from var(--THEME-panel) h s calc(l + 5));
	}
}

.prefix,
.suffix {
	display: flex;
	align-items: center;
	position: absolute;
	z-index: 1;
	top: 0;
	padding: 0 12px;
	font-size: 1em;
	height: v-bind("height + 'px'");
	min-width: 16px;
	max-width: 150px;
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
	box-sizing: border-box;
	pointer-events: none;

	&:empty {
		display: none;
	}
}

.prefix {
	left: 0;
	padding-right: 6px;
}

.suffix {
	right: 0;
	padding-left: 6px;
}
.save {
	margin: 8px 0 0 0;
}
</style>
