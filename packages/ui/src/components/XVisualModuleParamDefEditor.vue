<template>
<div :class="$style.root">
	<div :class="$style.fields">
		<GsInput :class="$style.field" type="text" :modelValue="def.label" @update:modelValue="value => update({ label: value })"/>
		<GsInput :class="$style.field" type="text" :modelValue="def.name" @update:modelValue="value => update({ name: value })"/>
		<GsSelect
			:class="$style.field"
			:modelValue="def.type"
			:items="[
				{ label: i18n.ts._Macro._Types.Number, value: 'number' },
				{ label: i18n.ts._Macro._Types.Range, value: 'range' },
				{ label: i18n.ts._Macro._Types.Flag, value: 'bool' },
				{ label: i18n.ts._Macro._Types.Color, value: 'color' },
				{ label: i18n.ts._Macro._Types.Image, value: 'image' },
			]"
			@update:modelValue="updateType"
		/>
	</div>
	<div v-if="['number', 'range'].includes(def.type)" :class="$style.option">
		<label :class="$style.optionLabel">Min/Max</label>
		<div :class="[$style.optionControl, { [$style.rangeBounds]: def.type === 'range' }]">
			<GsInput type="number" :modelValue="def.typeOptions.min" @update:modelValue="updateTypeOption('min', Number($event))"/>
			<GsInput type="number" :modelValue="def.typeOptions.max" @update:modelValue="updateTypeOption('max', Number($event))"/>
		</div>
	</div>
	<div v-if="['number', 'range'].includes(def.type)" :class="$style.option">
		<label :class="$style.optionLabel">Step</label>
		<div :class="$style.optionControl">
			<GsInput type="number" :modelValue="def.typeOptions.step" @update:modelValue="updateTypeOption('step', Number($event))"/>
		</div>
	</div>
	<div :class="$style.option">
		<GsSwitch :modelValue="def.canNode" @update:modelValue="updateCanNode">Allow node input</GsSwitch>
	</div>
	<div v-if="def.canNode && def.type === 'color'" :class="$style.option">
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
import type { EffectParamDataType, VisualModule } from '@glitch/shared/types.ts';
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

function updateType(type: EffectParamDataType) {
	if (type === props.def.type) return;
	const typeOptions = type === 'range' ? { min: 0, max: 1, step: 0.01 } : {};
	update({ type, typeOptions, defaultValue: genEmptyValue({ type, label: props.def.label, ...typeOptions }),
		isPrimaryInput: type === 'color' && props.def.canNode && props.def.isPrimaryInput });
}

function updateTypeOption(key: string, value: number) {
	update({ typeOptions: { ...props.def.typeOptions, [key]: value } });
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
