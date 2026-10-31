<template>
<div :class="$style.root" class="_gaps_m">
	<div :class="$style.fields">
		<GsInput large style="flex: 1" :class="$style.field" type="text" :modelValue="def.ui.label" @update:modelValue="value => update({ ui: { ...def.ui, label: value } })">
			<template #label>{{ i18n.ts._ParameterEditor.UiLabel }}</template>
		</GsInput>
		<GsInput large style="flex: 1" monospace :class="$style.field" type="text" :modelValue="def.nameForReference" @update:modelValue="value => update({ nameForReference: value })">
			<template #label>{{ i18n.ts._ParameterEditor.ReferenceName }}</template>
		</GsInput>
	</div>
	<div :class="$style.fields">
		<GsSelect large
			style="flex: 1"
			:class="$style.field"
			:modelValue="parameterType"
			:items="[
				{ label: i18n.ts._CustomParameterInput._Types.Number, value: 'scalar' },
				{ label: i18n.ts._CustomParameterInput._Types.Flag, value: 'bool' },
				{ label: i18n.ts._CustomParameterInput._Types.String, value: 'string' },
				{ label: i18n.ts._CustomParameterInput._Types.Color, value: 'color' },
				{ label: i18n.ts._ColorRamp.Title, value: 'colorRamp' },
				{ label: i18n.ts._CustomParameterInput._Types.Vector, value: 'vector' },
				{ label: i18n.ts._CustomParameterInput._Types.Enum, value: 'enum' },
				{ label: i18n.ts._CustomParameterInput._Types.SizeReference, value: 'sizeReference' },
				{ label: i18n.ts.Audio, value: 'audioSource' },
			].filter(item => supportedTypes == null || supportedTypes.includes(item.value))"
			@update:modelValue="updateType"
		>
			<template #label>{{ i18n.ts._ParameterEditor.DataType }}</template>
		</GsSelect>
		<GsSelect v-if="isParameterType(def, 'scalar')"
			large :class="$style.field" :modelValue="def.ui.control.controlType"
			style="flex: 1"
			:items="[{ label: i18n.ts._ParameterEditor.Number, value: 'number' }, { label: i18n.ts._ParameterEditor.Range, value: 'range' }, { label: i18n.ts._ParameterEditor.Angle, value: 'angle' }, { label: i18n.ts._ParameterEditor.Seed, value: 'seed' }]"
			@update:modelValue="updateControl"
		>
			<template #label>{{ i18n.ts._ParameterEditor.Control }}</template>
		</GsSelect>
	</div>

	<div v-if="isParameterType(def, 'scalar') && (def.ui.control.controlType === 'number' || def.ui.control.controlType === 'range')" :class="$style.option">
		<label :class="$style.optionLabel">{{ i18n.ts._ParameterEditor.MinMax }}</label>
		<div :class="[$style.optionControl, { [$style.rangeBounds]: def.ui.control.controlType === 'range' }]">
			<GsInput large type="number" :modelValue="def.ui.control.min ?? null" @update:modelValue="updateUiOption('min', Number($event))"/>
			<GsInput large type="number" :modelValue="def.ui.control.max ?? null" @update:modelValue="updateUiOption('max', Number($event))"/>
		</div>
	</div>
	<div v-if="isParameterType(def, 'scalar') && (def.ui.control.controlType === 'number' || def.ui.control.controlType === 'range')" :class="$style.option">
		<label :class="$style.optionLabel">{{ i18n.ts._ParameterEditor.Step }}</label>
		<div :class="$style.optionControl">
			<GsInput large type="number" :modelValue="def.ui.control.step ?? null" @update:modelValue="updateUiOption('step', Number($event))"/>
		</div>
	</div>
	<div v-if="isParameterType(def, 'enum')" :class="$style.option">
		<label :class="$style.optionLabel">{{ i18n.ts._CustomParameterInput.Options }}</label>
		<XEnumOptionsEditor :class="$style.optionControl" :options="def.dataType.options" :labels="def.ui.control.labels" :defaultValue="def.defaultValue.value" @update="updateEnumOptions"/>
	</div>
	<div v-if="def.dataType.kind !== 'array' && def.dataType.kind !== 'struct' && def.dataType.kind !== 'any' && def.dataType.kind !== 'enum' && def.dataType.kind !== 'audioSource'" :class="$style.option">
		<label :class="$style.optionLabel">{{ i18n.ts._CustomParameterInput.DefaultValue }}</label>
		<GsLiteralLeafValueControl
			:key="parameterType"
			:class="$style.optionControl"
			:dataType="def.dataType"
			:control="def.ui.control"
			:value="def.defaultValue.value"
			@input="updateDefaultValue"
			@beginChanging="beginDefaultValueChange"
			@changeContinuous="updateDefaultValueContinuously"
			@changeFinished="defaultValueMergeKey = null"
			@reset="updateDefaultValue(genEmptyValue(def))"
		/>
	</div>
	<div v-if="nodeInputEnabled && isTextureDataType(def.dataType) && def.dataType.kind !== 'any'" :class="$style.option">
		<GsSwitch :modelValue="def.canNode === true" @update:modelValue="updateCanNode">{{ i18n.ts._ParameterEditor.AllowNodeInput }}</GsSwitch>
	</div>
	<slot></slot>
	<GsButton danger @click="remove">{{ i18n.ts._ParameterEditor.Remove }}</GsButton>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { genEmptyValue } from '@gs/shared/parameter/parameter-default.ts';
import { isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { isTextureDataType } from '@gs/shared/data-type/data-type.ts';
import { genId } from '@gs/shared/utility/id.ts';
import GsSelect from './common/GsSelect.vue';
import GsInput from './common/GsInput.vue';
import GsButton from './common/GsButton.vue';
import GsSwitch from './common/GsSwitch.vue';
import GsLiteralLeafValueControl from './GsLiteralLeafValueControl.vue';
import XEnumOptionsEditor from './XEnumOptionsEditor.vue';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { CustomParameterDefinitionEdit } from '@/types/parameter-edit.ts';
import { i18n } from '@/i18n.ts';

type CustomParameterDefinition = ParameterDefinition & { nameForReference: string };
type EditableDataType = CustomParameterDefinition['dataType']['kind'];
const props = defineProps<{
	supportedTypes?: readonly string[];
	nodeInputEnabled?: boolean;
	def: CustomParameterDefinition;
}>();

const emit = defineEmits<{
	update: [changes: CustomParameterDefinitionEdit, mergeKey?: string | null];
	remove: [];
}>();

function update(changes: CustomParameterDefinitionEdit) {
	emit('update', changes);
}

let defaultValueMergeKey: string | null = null;

const parameterType = computed<EditableDataType>(() => props.def.dataType.kind);

function beginDefaultValueChange() {
	defaultValueMergeKey = genId();
}

function updateDefaultValue(value: any, mergeKey?: string | null) {
	emit('update', { defaultValue: { inputSource: 'literal', value } }, mergeKey);
}

function updateDefaultValueContinuously(value: any) {
	updateDefaultValue(value, defaultValueMergeKey);
}

function updateEnumOptions(options: string[], labels: Record<string, string>, defaultValue: string) {
	const def = props.def;
	if (!isParameterType(def, 'enum')) return;
	update({
		dataType: { kind: 'enum', options },
		ui: { ...def.ui, control: { labels } },
		defaultValue: { inputSource: 'literal', value: defaultValue },
	});
}

function updateType(dataType: EditableDataType) {
	if (dataType === parameterType.value) return;
	defaultValueMergeKey = null;
	if (dataType !== 'scalar' && dataType !== 'bool' && dataType !== 'string' && dataType !== 'color' && dataType !== 'colorRamp' && dataType !== 'vector' && dataType !== 'enum' && dataType !== 'sizeReference' && dataType !== 'audioSource') return;

	const schemas = {
		scalar: { dataType: { kind: 'scalar' }, ui: { label: props.def.ui.label, control: { controlType: 'number' } } },
		bool: { dataType: { kind: 'bool' }, ui: { label: props.def.ui.label, control: {} } },
		string: { dataType: { kind: 'string' }, ui: { label: props.def.ui.label, control: {} } },
		color: { dataType: { kind: 'color' }, ui: { label: props.def.ui.label, control: {} } },
		colorRamp: { dataType: { kind: 'colorRamp' }, ui: { label: props.def.ui.label, control: {} } },
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: props.def.ui.label, control: {} } },
		vector: { dataType: { kind: 'vector' }, ui: { label: props.def.ui.label, control: { controlType: 'vector' } } },
		enum: { dataType: { kind: 'enum', options: ['option1', 'option2'] }, ui: { label: props.def.ui.label, control: { labels: { option1: 'Option 1', option2: 'Option 2' } } } },
		audioSource: { dataType: { kind: 'audioSource' }, ui: { label: props.def.ui.label, control: {} } },
	} as const;

	const schema = schemas[dataType];

	update({
		...schema,
		// Inノードでは型変換せず公開するため、ノード入出力に対応しない型では解除する。
		canNode: isTextureDataType(schema.dataType) && props.def.canNode,
		defaultValue: { inputSource: 'literal', value: genEmptyValue(schema) },
	});
}

function updateControl(controlType: 'number' | 'range' | 'angle' | 'seed') {
	const def = props.def;
	if (!isParameterType(def, 'scalar') || def.ui.control.controlType === controlType) return;
	// UIだけを変更するときは、保存値・式・ノード接続を維持する。
	const previous = def.ui.control;
	const control = controlType === 'range'
		? {
			controlType,
			min: 'min' in previous ? previous.min ?? 0 : 0,
			max: 'max' in previous ? previous.max ?? 1 : 1,
			step: 'step' in previous ? previous.step ?? 0.01 : 0.01,
		}
		: { controlType };
	update({ dataType: { kind: 'scalar' }, ui: { label: def.ui.label, control } });
}

function updateUiOption(key: 'min' | 'max' | 'step', value: number) {
	const def = props.def;
	if (!isParameterType(def, 'scalar') || (def.ui.control.controlType !== 'number' && def.ui.control.controlType !== 'range')) return;
	update({ dataType: { kind: 'scalar' }, ui: { ...def.ui, control: { ...def.ui.control, [key]: value } } });
}

function updateCanNode(canNode: boolean) {
	if (!isTextureDataType(props.def.dataType) || props.def.dataType.kind === 'any') return;
	update({ canNode });
}

function remove() {
	emit('remove');
}
</script>

<style module lang="scss">
.root {
}

.fields {
	display: flex;
}

.field {
	margin: 0 2px;

	&:first-child {
		margin-left: 0;
	}

	&:last-child {
		margin-right: 0;
	}
}

.remove {
	width: 64px;
}

.option {
	display: flex;
}

.optionLabel {
	width: 30%;
	box-sizing: border-box;
	padding-left: 8px;
	padding-top: 4px;
	padding-right: 8px;
	flex-shrink: 0;
	white-space: nowrap;
	text-overflow: ellipsis;
	overflow: clip;
	cursor: pointer;
}

.optionControl {
	width: 70%;
	flex-shrink: 1;
}

.rangeBounds {
	display: flex;
	gap: 4px;
}
</style>
