<template>
<div class="_selectable" :class="[$style.root, { [$style.small]: small, [$style.large]: large }]">
	<div :class="$style.label" @click="focus"><slot name="label"></slot></div>
	<div :class="{ [$style.disabled]: disabled, [$style.focused]: focused, [$style.tall]: tall, [$style.pre]: pre, [$style.adaptiveHeight]: adaptiveHeight }" style="position: relative;">
		<textarea
			ref="inputEl"
			v-model="v"
			:class="[$style.textarea, { _monospace: code }]"
			:disabled="disabled"
			:required="required"
			:readonly="readonly"
			:placeholder="placeholder"
			:pattern="pattern"
			:autocomplete="autocomplete"
			:spellcheck="spellcheck"
			@focus="focused = true"
			@blur="focused = false"
			@keydown="onKeydown($event)"
			@input="onInput"
		></textarea>
	</div>
	<div :class="$style.caption"><slot name="caption" :value="v"></slot></div>

	<div v-if="manualSave && changed" :class="$style.manualSaveActions">
		<GsButton data-test-textarea-save small primary :disabled="disabled || readonly" icon="ti ti-check" @click="updated">{{ i18n.ts.Save }}</GsButton>
		<GsButton data-test-textarea-cancel small :disabled="disabled || readonly" icon="ti ti-x" @click="cancelEditing">{{ i18n.ts.Cancel }}</GsButton>
	</div>
</div>
</template>

<script lang="ts" setup>
import { onMounted, onUnmounted, nextTick, ref, watch, computed, toRefs, useTemplateRef } from 'vue';
import { debounce } from 'throttle-debounce';
import type { SuggestionType } from '@/utility/autocomplete.ts';
import GsButton from '@/components/common/GsButton.vue';
import { i18n } from '@/i18n.ts';
import { Autocomplete } from '@/utility/autocomplete.ts';

const props = defineProps<{
	modelValue: string | null;
	required?: boolean;
	readonly?: boolean;
	disabled?: boolean;
	pattern?: string;
	placeholder?: string;
	autofocus?: boolean;
	autocomplete?: string;
	spellcheck?: boolean;
	debounce?: boolean;
	manualSave?: boolean;
	code?: boolean;
	tall?: boolean;
	pre?: boolean;
	adaptiveHeight?: boolean;
	small?: boolean;
	large?: boolean;
}>();

const emit = defineEmits<{
	(ev: 'change', _ev: InputEvent): void;
	(ev: 'keydown', _ev: KeyboardEvent): void;
	(ev: 'enter'): void;
	(ev: 'update:modelValue', value: string): void;
	(ev: 'savingStateChange', saved: boolean, invalid: boolean): void;
}>();

const { modelValue, autofocus } = toRefs(props);
const v = ref<string>(modelValue.value ?? '');
const focused = ref(false);
const changed = ref(false);
const invalid = ref(false);
const filled = computed(() => v.value !== '' && v.value != null);
const inputEl = useTemplateRef('inputEl');
const preview = ref(false);
let autocompleteWorker: Autocomplete | null = null;

function focus() {
	inputEl.value?.focus();
}

function onInput(ev: InputEvent) {
	changed.value = true;
	emit('change', ev);
}

function onKeydown(ev: KeyboardEvent) {
	if (ev.isComposing || ev.key === 'Process' || ev.keyCode === 229) return;

	// 手動保存でも通常のEnterは改行に使い、IMEの確定や取消しでは本文を適用・破棄しない。
	if (props.manualSave && !props.disabled && !props.readonly) {
		if (changed.value && ev.key === 'Escape' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey) {
			ev.preventDefault();
			ev.stopPropagation();
			cancelEditing();
			return;
		}
		if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && (ev.key === 'Enter' || ev.key.toLowerCase() === 's')) {
			ev.preventDefault();
			ev.stopPropagation();
			if (!ev.repeat) updated();
			return;
		}
	}

	emit('keydown', ev);

	if (ev.code === 'Enter') {
		emit('enter');
	}

	if (props.code && ev.key === 'Tab') {
		const pos = inputEl.value?.selectionStart ?? 0;
		const posEnd = inputEl.value?.selectionEnd ?? v.value.length;
		v.value = v.value.slice(0, pos) + '\t' + v.value.slice(posEnd);
		nextTick(() => {
			inputEl.value?.setSelectionRange(pos + 1, pos + 1);
		});
		ev.preventDefault();
	}
}

function updated() {
	changed.value = false;
	// 親からの同期や変更のない保存を新しい編集として返すと、Undo/Redo履歴が壊れる。
	if (v.value === (modelValue.value ?? '')) return;
	emit('update:modelValue', v.value);
}

const debouncedUpdated = debounce(1000, updated);

function cancelEditing() {
	debouncedUpdated.cancel({ upcomingOnly: true });
	v.value = modelValue.value ?? '';
	changed.value = false;
	focus();
}

watch(modelValue, newValue => {
	// 古いドラフトの遅延通知で、外部から確定した値を上書きしない。
	debouncedUpdated.cancel({ upcomingOnly: true });
	changed.value = false;
	v.value = newValue ?? '';
});

watch(v, () => {
	if (props.manualSave) {
		// codeモードのTab挿入のような、inputイベントを伴わない編集も保存・取消しの対象にする。
		changed.value = v.value !== (modelValue.value ?? '');
	} else if (v.value !== (modelValue.value ?? '')) {
		if (props.debounce) {
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

onMounted(() => {
	nextTick(() => {
		if (autofocus.value) {
			focus();
		}
	});

	if (props.autocomplete && inputEl.value) {
		autocompleteWorker = new Autocomplete(inputEl.value, v);
	}
});

onUnmounted(() => {
	debouncedUpdated.cancel({ upcomingOnly: true });
	if (autocompleteWorker) {
		autocompleteWorker.detach();
	}
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

.textarea {
	appearance: none;
	-webkit-appearance: none;
	display: block;
	width: 100%;
	min-width: 100%;
	max-width: 100%;
	min-height: 130px;
	margin: 0;
	padding: 4px 10px;
	field-sizing: content;
	font: inherit;
	font-weight: normal;
	font-size: 1em;
	color: var(--THEME-fg);
	background: var(--THEME-input);
	border: solid 1px var(--THEME-input);
	border-radius: 6px;
	outline: none;
	box-shadow: none;
	box-sizing: border-box;
	transition: border-color 0.1s ease-out;

	&:hover {
		border-color: var(--THEME-accent) !important;
	}
}

.adaptiveHeight {
	> .textarea {
		min-height: var(--height);
	}
}

.focused {
	> .textarea {
		border-color: var(--THEME-accent) !important;
	}
}

.disabled {
	opacity: 0.7;
	cursor: not-allowed !important;

	> .textarea {
		cursor: not-allowed !important;
	}
}

.tall {
	> .textarea {
		min-height: 200px;
	}
}

.pre {
	> .textarea {
		white-space: pre;
	}
}

.manualSaveActions {
	display: flex;
	gap: 8px;
	margin: 8px 0 0 0;
}
</style>
