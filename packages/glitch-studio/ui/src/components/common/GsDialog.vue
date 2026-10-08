<template>
<GsModal ref="modal" :preferType="'dialog'" :zPriority="'high'" @click="done(true)" @closed="emit('closed')" @esc="cancel()">
	<div :class="$style.root">
		<div v-if="icon" :class="$style.icon">
			<i :class="icon"></i>
		</div>
		<div
			v-else-if="!input && !select"
			:class="[$style.icon]"
		>
			<GsSystemIcon v-if="type === 'success'" :class="$style.iconInner" style="width: 45px;" type="success"/>
			<GsSystemIcon v-else-if="type === 'error'" :class="$style.iconInner" style="width: 45px;" type="error"/>
			<GsSystemIcon v-else-if="type === 'warning'" :class="$style.iconInner" style="width: 45px;" type="warn"/>
			<GsSystemIcon v-else-if="type === 'info'" :class="$style.iconInner" style="width: 45px;" type="info"/>
			<GsSystemIcon v-else-if="type === 'question'" :class="$style.iconInner" style="width: 45px;" type="question"/>
			<GsLoading v-else-if="type === 'waiting'" :class="$style.iconInner" :em="true"/>
		</div>
		<header v-if="title" :class="$style.title" class="_selectable">{{ title }}</header>
		<div v-if="text" :class="$style.text" class="_selectable">{{ text }}</div>
		<GsInput v-if="input" v-model="inputValue" autofocus :type="input.type || 'text'" :placeholder="input.placeholder || undefined" :autocomplete="input.autocomplete" @keydown="onInputKeydown">
			<template v-if="input.type === 'password'" #prefix><i class="ti ti-lock"></i></template>
		</GsInput>
		<GsSelect v-if="select" v-model="selectedValue" :items="selectDef" autofocus></GsSelect>
		<div v-if="(showOkButton || showCancelButton) && !actions" :class="$style.buttons">
			<GsButton v-if="showOkButton" data-testid="modal-dialog-ok" inline primary rounded :autofocus="!input && !select" @click="ok">{{ okText ?? ((showCancelButton || input || select) ? 'OK' : 'Got It') }}</GsButton>
			<GsButton v-if="showCancelButton || input || select" data-testid="modal-dialog-cancel" inline rounded @click="cancel">{{ cancelText ?? 'Cancel' }}</GsButton>
		</div>
		<div v-if="actions" :class="$style.buttons">
			<GsButton v-for="action in actions" :key="action.text" inline rounded :primary="action.primary" :danger="action.danger" @click="() => { action.callback(); modal?.close(); }">{{ action.text }}</GsButton>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts">
export type Result = string | number | true | null;
export type GsDialogReturnType<T = Result> = { canceled: true, result: undefined } | { canceled: false, result: T };
</script>

<script lang="ts" setup>
import { ref, useTemplateRef, computed } from 'vue';
import type { GsSelectItem } from '@/components/common/GsSelect.vue';
import type { OptionValue } from '@/types/option-value.ts';
import GsModal from '@/components/common/GsModal.vue';
import GsButton from '@/components/common/GsButton.vue';
import GsSystemIcon from '@/components/common/GsSystemIcon.vue';
import GsInput from '@/components/common/GsInput.vue';
import GsSelect from '@/components/common/GsSelect.vue';
import GsLoading from '@/components/common/GsLoading.vue';
import { useGsSelect } from '@/composables/useGsSelect.ts';
import { i18n } from '@/i18n.ts';

type Input = {
	type?: 'text' | 'number' | 'password' | 'email' | 'url' | 'date' | 'time' | 'search' | 'datetime-local';
	placeholder?: string | null;
	autocomplete?: string;
	default: string | number | null;
	minLength?: number;
	maxLength?: number;
};

type Select = {
	items: GsSelectItem[];
	default: OptionValue | null;
};

const props = withDefaults(defineProps<{
	type?: 'success' | 'error' | 'warning' | 'info' | 'question' | 'waiting';
	title?: string;
	text?: string;
	input?: Input;
	select?: Select;
	icon?: string;
	actions?: {
		text: string;
		primary?: boolean,
		danger?: boolean,
		callback: (...args: unknown[]) => void;
	}[];
	showOkButton?: boolean;
	showCancelButton?: boolean;
	cancelableByBgClick?: boolean;
	okText?: string;
	cancelText?: string;
}>(), {
	type: 'info',
	showOkButton: true,
	showCancelButton: false,
	cancelableByBgClick: true,
});

const emit = defineEmits<{
	(ev: 'done', v: GsDialogReturnType): void;
	(ev: 'closed'): void;
}>();

const modal = useTemplateRef('modal');

const inputValue = ref<string | number | null>(props.input?.default ?? null);

const {
	def: selectDef,
	model: selectedValue,
} = useGsSelect({
	items: computed(() => props.select?.items ?? []),
	initialValue: props.select?.default ?? null,
});

// overload function を使いたいので lint エラーを無視する
function done(canceled: true): void;
function done(canceled: false, result: Result): void; // eslint-disable-line no-redeclare

function done(canceled: boolean, result?: Result): void { // eslint-disable-line no-redeclare
	emit('done', { canceled, result } as GsDialogReturnType);
	modal.value?.close();
}

async function ok() {
	if (!props.showOkButton) return;

	const result =
		props.input ? inputValue.value :
		props.select ? selectedValue.value :
		true;
	done(false, result);
}

function cancel() {
	done(true);
}

/*
function onBgClick() {
	if (props.cancelableByBgClick) cancel();
}
*/
function onInputKeydown(evt: KeyboardEvent) {
	if (evt.key === 'Enter') {
		evt.preventDefault();
		evt.stopPropagation();
		ok();
	}
}
</script>

<style lang="scss" module>
.root {
	position: relative;
	margin: auto;
	padding: 32px;
	min-width: 320px;
	max-width: 480px;
	box-sizing: border-box;
	text-align: center;
	background: var(--THEME-panel);
	border-radius: 12px;
}

.icon {
	font-size: 24px;

	& + .title {
		margin-top: 8px;
	}
}

.iconInner {
	display: block;
	margin: 0 auto;
}

.title {
	margin: 0 0 8px 0;
	font-weight: bold;
	font-size: 1.1em;

	& + .text {
		margin-top: 8px;
	}
}

.text {
	margin: 16px 0 0 0;
}

.buttons {
	margin-top: 16px;
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
	justify-content: center;
}
</style>
