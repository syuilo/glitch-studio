<template>
<GsModal ref="modal" :preferType="'dialog'" :zPriority="'high'" @click="done(true)" @closed="emit('closed')" @esc="cancel()">
	<div :class="$style.root">
		<header v-if="title" :class="$style.title" class="_selectable">{{ title }}</header>
		<div v-if="text" :class="$style.text" class="_selectable">{{ text }}</div>
		<GsInput v-if="input" v-model="inputValue" large autofocus :type="input.type || 'text'" :placeholder="input.placeholder || undefined" :autocomplete="input.autocomplete" @keydown="onInputKeydown">
			<template v-if="input.type === 'password'" #prefix><i class="ti ti-lock"></i></template>
		</GsInput>
		<GsSelect v-if="select" v-model="selectedValue" large :items="selectDef" autofocus></GsSelect>
		<div :class="$style.buttons">
			<GsButton large inline primary @click="ok">{{ okText ?? 'OK' }}</GsButton>
			<GsButton large inline @click="cancel">{{ i18n.ts.Cancel }}</GsButton>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts">
export type Result = string | number | true | null;
export type GsInputDialogReturnType<T = Result> = { canceled: true, result: undefined } | { canceled: false, result: T };
</script>

<script lang="ts" setup>
import { ref, useTemplateRef, computed } from 'vue';
import type { GsSelectItem } from '@/components/common/GsSelect.vue';
import type { OptionValue } from '@/types/option-value.ts';
import GsModal from '@/components/common/GsModal.vue';
import GsButton from '@/components/common/GsButton.vue';
import GsInput from '@/components/common/GsInput.vue';
import GsSelect from '@/components/common/GsSelect.vue';
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

const props = defineProps<{
	title?: string;
	text?: string;
	input?: Input;
	select?: Select;
	okText?: string;
}>();

const emit = defineEmits<{
	(ev: 'done', v: GsInputDialogReturnType): void;
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
	emit('done', { canceled, result } as GsInputDialogReturnType);
	modal.value?.close();
}

async function ok() {
	const result =
		props.input ? inputValue.value :
		props.select ? selectedValue.value :
		true;
	done(false, result);
}

function cancel() {
	done(true);
}

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
	padding: 28px;
	min-width: 320px;
	max-width: 480px;
	box-sizing: border-box;
	text-align: center;
	background: var(--THEME-panel);
	border-radius: 10px;
}

.title {
	margin: 0 0 8px 0;
	font-weight: bold;
	font-size: 120%;

	& + .text {
		margin-top: 8px;
	}
}

.text {
	margin: 8px 0 0 0;
	font-size: 110%;
}

.buttons {
	margin-top: 12px;
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
	justify-content: center;
}
</style>
