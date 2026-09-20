<template>
<div :class="$style.root">
	<div :class="$style.fields">
		<GsInput :class="$style.field" type="text" :modelValue="def.label" @update:modelValue="value => update({ label: value })"/>
		<GsInput :class="$style.field" type="text" :modelValue="def.name" @update:modelValue="value => update({ name: value })"/>
		<GsSelect
			:class="$style.field"
			:modelValue="def.dataType"
			:items="[
				{ label: i18n.ts._ExternalParameterInput._Types.Number, value: 'number' },
				{ label: i18n.ts._ExternalParameterInput._Types.Flag, value: 'bool' },
				{ label: i18n.ts._ExternalParameterInput._Types.Color, value: 'color' },
				{ label: i18n.ts._ExternalParameterInput._Types.Image, value: 'assetReference' },
			]"
			@update:modelValue="updateType"
		/>
		<GsSelect v-if="def.dataType === 'number'" :class="$style.field" :modelValue="def.ui.control"
			:items="[{ label: 'Number', value: 'number' }, { label: 'Range', value: 'range' }, { label: 'Angle', value: 'angle' }, { label: 'Seed', value: 'seed' }]"
			@update:modelValue="updateControl"/>
	</div>
	<div v-if="def.dataType === 'number' && (def.ui.control === 'number' || def.ui.control === 'range')" :class="$style.option">
		<label :class="$style.optionLabel">Min/Max</label>
		<div :class="[$style.optionControl, { [$style.rangeBounds]: def.ui.control === 'range' }]">
			<GsInput type="number" :modelValue="def.ui.min ?? null" @update:modelValue="updateUiOption('min', Number($event))"/>
			<GsInput type="number" :modelValue="def.ui.max ?? null" @update:modelValue="updateUiOption('max', Number($event))"/>
		</div>
	</div>
	<div v-if="def.dataType === 'number' && (def.ui.control === 'number' || def.ui.control === 'range')" :class="$style.option">
		<label :class="$style.optionLabel">Step</label>
		<div :class="$style.optionControl">
			<GsInput type="number" :modelValue="def.ui.step ?? null" @update:modelValue="updateUiOption('step', Number($event))"/>
		</div>
	</div>
	<div :class="$style.option">
		<GsSwitch :modelValue="def.canNode" @update:modelValue="updateCanNode">Allow node input</GsSwitch>
	</div>
	<div v-if="def.canNode && def.dataType === 'color'" :class="$style.option">
		<GsSwitch
			:modelValue="def.isPrimaryInput"
			:disabled="!def.isPrimaryInput && hasPrimaryInput"
			@update:modelValue="update({ isPrimaryInput: $event })"
		>Primary input</GsSwitch>
	</div>
	<GsButton small danger @click="remove">Remove parameter</GsButton>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import GsSelect from './common/GsSelect.vue';
import GsInput from './common/GsInput.vue';
import GsButton from './common/GsButton.vue';
import GsSwitch from './common/GsSwitch.vue';
import { genEmptyValue } from '@glitch/shared/utility/misc.ts';
import type { VisualModule } from '@glitch/shared/types.ts';
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

function updateType(dataType: ParamDef['dataType']) {
	if (dataType === props.def.dataType) return;
	if (dataType !== 'number' && dataType !== 'bool' && dataType !== 'color' && dataType !== 'assetReference') return;
	const schemas = {
		number: { dataType: 'number', ui: { control: 'number' } },
		bool: { dataType: 'bool', ui: { control: 'bool' } },
		color: { dataType: 'color', ui: { control: 'color' } },
		assetReference: { dataType: 'assetReference', ui: { control: 'image' } },
	} as const;
	const schema = { ...schemas[dataType], label: props.def.label };
	update({ ...schema, defaultValue: genEmptyValue(schema),
		isPrimaryInput: dataType === 'color' && props.def.canNode && props.def.isPrimaryInput });
}

function updateControl(control: 'number' | 'range' | 'angle' | 'seed') {
	if (props.def.dataType !== 'number' || props.def.ui.control === control) return;
	// UIだけを変更するときは、保存値・式・ノード接続を維持する。
	const previous = props.def.ui;
	const ui = control === 'range'
		? { control, min: 'min' in previous ? previous.min ?? 0 : 0, max: 'max' in previous ? previous.max ?? 1 : 1, step: 'step' in previous ? previous.step ?? 0.01 : 0.01 }
		: { control };
	update({ dataType: 'number', ui });
}

function updateUiOption(key: 'min' | 'max' | 'step', value: number) {
	const def = props.def;
	if (def.dataType !== 'number' || (def.ui.control !== 'number' && def.ui.control !== 'range')) return;
	update({ dataType: 'number', ui: { ...def.ui, [key]: value } });
}

function updateCanNode(canNode: boolean) {
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
