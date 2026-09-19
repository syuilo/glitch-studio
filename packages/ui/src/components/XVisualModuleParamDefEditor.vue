<template>
<div :class="$style.root">
	<div :class="$style.fields">
		<GsInput :class="$style.field" type="text" :modelValue="def.label" @update:modelValue="updateMacroLabel"/>
		<GsInput :class="$style.field" type="text" :modelValue="def.name" @update:modelValue="updateMacroName"/>
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
			@update:modelValue="v => updateMacroType(v)"
		/>
	</div>
	<div v-if="['number', 'range'].includes(def.type)" :class="$style.option">
		<label :class="$style.optionLabel">Min/Max</label>
		<div :class="[$style.optionControl, { [$style.rangeBounds]: def.type === 'range' }]">
			<GsInput type="number" :modelValue="def.typeOptions.min" @update:modelValue="updateMacroTypeOption(def, 'min', parseFloat($event, 10))"/>
			<GsInput type="number" :modelValue="def.typeOptions.max" @update:modelValue="updateMacroTypeOption(def, 'max', parseFloat($event, 10))"/>
		</div>
	</div>
	<div v-if="['number', 'range'].includes(def.type)" :class="$style.option">
		<label :class="$style.optionLabel">Step</label>
		<div :class="$style.optionControl">
			<GsInput type="number" :modelValue="def.typeOptions.step" @update:modelValue="updateMacroTypeOption(def, 'step', parseFloat($event, 10))"/>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import GsSelect from './common/GsSelect.vue';
import GsInput from './common/GsInput.vue';
import GsButton from './common/GsButton.vue';
import type { GsGroupNode, Macro, VisualModule } from '@glitch/shared/types.ts';
import { appContext } from '@/app.ts';
import { i18n } from '@/i18n.ts';

const props = defineProps<{
	def: VisualModule['paramDefs'][number];
}>();

function updateMacroLabel(def: Macro, value: string) {
	appContext.commit('updateMacroLabel', {
		defId: def.id,
		value: value,
		groupId: props.group?.id,
	});
}

function updateMacroName(def: Macro, value: string) {
	appContext.commit('updateMacroName', {
		defId: def.id,
		value: value,
		groupId: props.group?.id,
	});
}

function updateMacroType(def: Macro, value: FxParamDataType) {
	appContext.commit('updateMacroType', {
		defId: def.id,
		value: value,
		groupId: props.group?.id,
	});
}

function updateMacroTypeOption(def: Macro, key: string, value: any) {
	appContext.commit('updateMacroTypeOption', {
		defId: def.id,
		key: key,
		value: value,
		groupId: props.group?.id,
	});
}

function remove(defId: string) {
	appContext.commit('removeMacro', {
		defId: defId,
		groupId: props.group?.id,
	});
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
