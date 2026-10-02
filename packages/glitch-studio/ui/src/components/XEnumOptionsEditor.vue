<template>
<div :class="$style.root">
	<div :class="$style.headings">
		<span>{{ i18n.ts._CustomParameterInput.OptionValue }}</span>
		<span>{{ i18n.ts._CustomParameterInput.Label }}</span>
	</div>
	<div v-for="(option, index) in draft" :key="option.id" :class="$style.row">
		<GsInput v-model="option.value" small :class="$style.field" type="text"/>
		<GsInput v-model="option.label" small :class="$style.field" type="text"/>
		<GsButton small iconOnly danger :disabled="draft.length === 1" :title="i18n.ts._CustomParameterInput.RemoveOption" @click="draft.splice(index, 1)"><i class="ti ti-trash"></i></GsButton>
	</div>
	<div v-if="invalid" :class="$style.error">{{ i18n.ts._CustomParameterInput.InvalidOptions }}</div>
	<GsSelect v-model="draftDefaultValue" :items="draft.map(option => ({ value: option.value, label: option.label || option.value }))" :disabled="invalid">
		<template #label>{{ i18n.ts._CustomParameterInput.DefaultValue }}</template>
	</GsSelect>
	<div v-if="invalidDefault" :class="$style.error">{{ i18n.ts._CustomParameterInput.SelectValidDefault }}</div>
	<div :class="$style.actions">
		<GsButton small @click="add">{{ i18n.ts._CustomParameterInput.AddOption }}</GsButton>
		<GsButton small primary :disabled="!changed || invalid || invalidDefault" @click="apply">{{ i18n.ts._CustomParameterInput.ApplyOptions }}</GsButton>
		<GsButton v-if="changed" small @click="reset">{{ i18n.ts._CustomParameterInput.DiscardOptions }}</GsButton>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, nextTick, ref, watch } from 'vue';
import { genId } from '@glitch/shared/utility/id.ts';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import GsButton from './common/GsButton.vue';
import { i18n } from '@/i18n.ts';

const props = defineProps<{
	options: readonly string[];
	labels: Record<string, string>;
	defaultValue: string;
}>();
const emit = defineEmits<{
	update: [options: string[], labels: Record<string, string>, defaultValue: string];
}>();

const draft = ref<{ id: string; value: string; label: string }[]>([]);
const draftDefaultValue = ref('');
const savedRows = computed(() => props.options.map(value => ({ value, label: props.labels[value] ?? value })));
const changed = computed(() => draftDefaultValue.value !== props.defaultValue
	|| JSON.stringify(draft.value.map(({ value, label }) => ({ value, label }))) !== JSON.stringify(savedRows.value));
const invalid = computed(() => draft.value.length === 0
	|| draft.value.some(option => option.value.trim() === '')
	|| new Set(draft.value.map(option => option.value)).size !== draft.value.length);
const invalidDefault = computed(() => !draft.value.some(option => option.value === draftDefaultValue.value));

function reset() {
	draft.value = savedRows.value.map(option => ({ ...option, id: genId() }));
	draftDefaultValue.value = props.defaultValue;
}

// 入力途中の空欄・重複はローカルに留め、適用時に定義全体を1回のUndo単位で更新する。
// デフォルト値も同時に適用し、削除・改名によって無効になったときは明示的な再選択を求める。
// 関係のない定義の更新では下書きを捨てず、Undo/Redoには追従する。
watch(() => JSON.stringify([savedRows.value, props.defaultValue]), reset, { immediate: true });

function add() {
	let value = 'option';
	for (let suffix = 2; draft.value.some(option => option.value === value); suffix++) value = `option${suffix}`;
	draft.value.push({ id: genId(), value, label: value });
}

function move(index: number, direction: -1 | 1) {
	const destination = index + direction;
	if (destination < 0 || destination >= draft.value.length) return;
	const [option] = draft.value.splice(index, 1);
	draft.value.splice(destination, 0, option);
}

async function apply() {
	if (invalid.value || invalidDefault.value || !changed.value) return;
	emit('update', draft.value.map(option => option.value), Object.fromEntries(draft.value.map(option => [option.value, option.label || option.value])), draftDefaultValue.value);
	await nextTick();
	reset();
}
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.headings {
	display: grid;
	grid-template-columns: 1fr 1fr;
	padding-right: 108px;
	gap: 6px;
	font-size: 0.85em;
	opacity: 0.7;
}

.row, .actions {
	display: flex;
	align-items: center;
	gap: 6px;
}

.actions {
	flex-wrap: wrap;
}

.field {
	flex: 1;
	min-width: 0;
}

.error {
	color: var(--THEME-error);
}
</style>
