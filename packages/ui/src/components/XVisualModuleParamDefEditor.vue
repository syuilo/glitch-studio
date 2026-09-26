<template>
<div :class="$style.root">
	<div :class="$style.fields">
		<GsInput :class="$style.field" type="text" :modelValue="def.ui.label" @update:modelValue="value => update({ ui: { ...def.ui, label: value } })"/>
		<GsInput :class="$style.field" type="text" :modelValue="def.nameForReference" @update:modelValue="value => update({ nameForReference: visualModuleCustomParameterName(value) })"/>
		<GsSelect
			:class="$style.field"
			:modelValue="def.dataType.kind"
			:items="[
				{ label: i18n.ts._CustomParameterInput._Types.Number, value: 'scalar' },
				{ label: i18n.ts._CustomParameterInput._Types.Flag, value: 'bool' },
				{ label: i18n.ts._CustomParameterInput._Types.String, value: 'string' },
				{ label: i18n.ts._CustomParameterInput._Types.Color, value: 'color' },
				{ label: i18n.ts._CustomParameterInput._Types.Image, value: 'assetReference' },
				{ label: 'Video asset', value: 'videoAssetReference' },
			]"
			@update:modelValue="updateType"
		/>
		<GsSelect
			v-if="isParameterType(def, 'scalar')" :class="$style.field" :modelValue="def.ui.control.controlType"
			:items="[{ label: 'Number', value: 'number' }, { label: 'Range', value: 'range' }, { label: 'Angle', value: 'angle' }, { label: 'Seed', value: 'seed' }]"
			@update:modelValue="updateControl"
		/>
	</div>
	<div v-if="isParameterType(def, 'scalar') && (def.ui.control.controlType === 'number' || def.ui.control.controlType === 'range')" :class="$style.option">
		<label :class="$style.optionLabel">Min/Max</label>
		<div :class="[$style.optionControl, { [$style.rangeBounds]: def.ui.control.controlType === 'range' }]">
			<GsInput type="number" :modelValue="def.ui.control.min ?? null" @update:modelValue="updateUiOption('min', Number($event))"/>
			<GsInput type="number" :modelValue="def.ui.control.max ?? null" @update:modelValue="updateUiOption('max', Number($event))"/>
		</div>
	</div>
	<div v-if="isParameterType(def, 'scalar') && (def.ui.control.controlType === 'number' || def.ui.control.controlType === 'range')" :class="$style.option">
		<label :class="$style.optionLabel">Step</label>
		<div :class="$style.optionControl">
			<GsInput type="number" :modelValue="def.ui.control.step ?? null" @update:modelValue="updateUiOption('step', Number($event))"/>
		</div>
	</div>
	<div v-if="isTextureDataType(def.dataType) && def.dataType.kind !== 'any'" :class="$style.option">
		<GsSwitch :modelValue="def.canNode" @update:modelValue="updateCanNode">Allow node input</GsSwitch>
	</div>
	<div v-if="def.canNode && def.dataType.kind === 'color'" :class="$style.option">
		<GsSwitch
			:modelValue="def.isPrimaryInput"
			:disabled="!def.isPrimaryInput && hasPrimaryInput"
			@update:modelValue="update({ isPrimaryInput: $event })"
		>
			Primary input
		</GsSwitch>
	</div>
	<GsButton small danger @click="remove">Remove parameter</GsButton>
</div>
</template>

<script lang="ts" setup>
import { visualModuleCustomParameterName } from '@glitch/shared/visual-module/types.ts';
import { computed } from 'vue';
import { genEmptyValue } from '@glitch/shared/utility/misc.ts';
import { isParameterType } from '@glitch/shared/parameter.ts';
import { isTextureDataType } from '@glitch/shared/data-type.ts';
import GsSelect from './common/GsSelect.vue';
import GsInput from './common/GsInput.vue';
import GsButton from './common/GsButton.vue';
import GsSwitch from './common/GsSwitch.vue';
import type { VisualModule } from '@glitch/shared/visual-module/types.ts';
import { appContext } from '@/app.ts';
import { i18n } from '@/i18n.ts';

type ParamDef = VisualModule['paramDefs'][number];
const props = defineProps<{
	visualModuleId: string;
	def: ParamDef;
}>();

const hasPrimaryInput = computed(() => appContext.state.visualModules.value
	.find(module => module.id === props.visualModuleId)?.paramDefs.some(def => def.isPrimaryInput) ?? false);

function update(changes: Partial<Omit<ParamDef, 'id'>>) {
	appContext.commit('updateVisualModuleParamDef', { visualModuleId: props.visualModuleId, defId: props.def.id, changes });
}

function updateType(dataType: ParamDef['dataType']['kind']) {
	if (dataType === props.def.dataType.kind) return;
	if (dataType !== 'scalar' && dataType !== 'bool' && dataType !== 'string' && dataType !== 'color' && dataType !== 'assetReference' && dataType !== 'videoAssetReference') return;

	const schemas = {
		scalar: { dataType: { kind: 'scalar' }, ui: { label: props.def.ui.label, control: { controlType: 'number' } } },
		bool: { dataType: { kind: 'bool' }, ui: { label: props.def.ui.label, control: {} } },
		string: { dataType: { kind: 'string' }, ui: { label: props.def.ui.label, control: {} } },
		color: { dataType: { kind: 'color' }, ui: { label: props.def.ui.label, control: {} } },
		assetReference: { dataType: { kind: 'assetReference' }, ui: { label: props.def.ui.label, control: {} } },
		videoAssetReference: { dataType: { kind: 'videoAssetReference' }, ui: { label: props.def.ui.label, control: {} } },
	} as const;

	const schema = schemas[dataType];

	update({
		...schema,
		// Inノードでは型変換せず公開するため、ノード入出力に対応しない型では解除する。
		canNode: isTextureDataType(schema.dataType) && props.def.canNode,
		defaultValue: { inputSource: 'literal', value: genEmptyValue(schema) },
		isPrimaryInput: dataType === 'color' && props.def.canNode && props.def.isPrimaryInput,
	});
}

function updateControl(controlType: 'number' | 'range' | 'angle' | 'seed') {
	const def = props.def;
	if (!isParameterType(def, 'scalar') || def.ui.control.controlType === controlType) return;
	// UIだけを変更するときは、保存値・式・ノード接続を維持する。
	const previous = def.ui.control;
	const control = controlType === 'range'
		? { controlType, min: 'min' in previous ? previous.min ?? 0 : 0, max: 'max' in previous ? previous.max ?? 1 : 1, step: 'step' in previous ? previous.step ?? 0.01 : 0.01 }
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
	update({ canNode, isPrimaryInput: canNode && props.def.isPrimaryInput });
}

function remove() {
	appContext.commit('removeVisualModuleParamDef', { visualModuleId: props.visualModuleId, defId: props.def.id });
}
</script>

<style module lang="scss">
.root {
	padding: 8px 0;

	&:not(:first-child) {
		border-top: solid 1px #0006;
	}
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
	padding: 8px 0;
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
	overflow: hidden;
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
