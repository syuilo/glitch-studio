<template>
<div :class="$style.root" class="_gaps_m" data-test-custom-shader-effect-editor>
	<div :class="$style.actions">
		<GsButton data-test-apply-custom-shader-effect primary :disabled="!changed || validationError != null" icon="ti ti-check" @click="apply">{{ i18n.ts.Apply }}</GsButton>
		<GsButton data-test-reset-custom-shader-effect :disabled="!changed" @click="resetDraft">{{ i18n.ts._CustomShaderEffect.Discard }}</GsButton>
		<span v-if="changed" data-test-custom-shader-effect-unapplied>{{ i18n.ts._CustomShaderEffect.Unapplied }}</span>
	</div>
	<div v-if="validationError != null" :class="$style.error" data-test-custom-shader-effect-error>{{ validationError }}</div>
	<GsTabs v-model="tab" :def="tabs" data-test-custom-shader-effect-tabs/>
	<template v-if="tab === 'code'">
		<GsTextarea v-model="draft.code" data-test-custom-shader-effect-code code tall pre :spellcheck="false">
			<template #label>WGSL</template>
		</GsTextarea>
		<GsTextarea :modelValue="interfaceDescription" readonly code pre adaptiveHeight data-test-custom-shader-effect-interface>
			<template #label>{{ i18n.ts._CustomShaderEffect.Interface }}</template>
		</GsTextarea>
		<div>{{ i18n.ts._CustomShaderEffect.Coordinates }}</div>
		<div>{{ i18n.ts._CustomShaderEffect.ColorAndTime }}</div>
	</template>
	<template v-else-if="tab === 'inputs'">
		<div>{{ i18n.ts._CustomShaderEffect.ReferenceNames }}</div>
		<GsFolder v-for="(parameter, index) in draft.paramDefs" :key="parameter.id" defaultOpen>
			<template #label>{{ parameter.ui.label }}</template>
			<XPublicParameterDefinitionEditor :def="parameter" :supportedTypes="supportedTypes" :data-test-custom-shader-effect-parameter="parameter.id" @update="updateParameter(parameter.id, $event)" @remove="removeParameter(parameter.id)"/>
			<GsSwitch :modelValue="draft.resolutionInputIds.includes(parameter.id)" @update:modelValue="setResolutionInput(parameter.id, $event)">{{ i18n.ts._CustomShaderEffect.ResolutionInput }}</GsSwitch>
			<div :class="$style.actions">
				<GsButton :disabled="index === 0" icon="ti ti-arrow-up" @click="move(draft.paramDefs, index, -1)">{{ i18n.ts._CustomShaderEffect.MoveUp }}</GsButton>
				<GsButton :disabled="index === draft.paramDefs.length - 1" icon="ti ti-arrow-down" @click="move(draft.paramDefs, index, 1)">{{ i18n.ts._CustomShaderEffect.MoveDown }}</GsButton>
			</div>
		</GsFolder>
		<GsButton data-test-add-custom-shader-effect-parameter icon="ti ti-plus" @click="addParameter">{{ i18n.ts._CustomShaderEffect.AddInput }}</GsButton>
	</template>
	<template v-else-if="tab === 'outputs'">
		<div>{{ i18n.ts._CustomShaderEffect.ReferenceNames }}</div>
		<GsFolder v-for="(output, index) in draft.outputDefs" :key="output.id" defaultOpen>
			<template #label>{{ output.label }}</template>
			<div class="_gaps_m">
				<GsInput v-model="output.label" :data-test-custom-shader-effect-output-label="output.id"><template #label>{{ i18n.ts.Label }}</template></GsInput>
				<GsInput v-model="output.nameForReference" monospace :data-test-custom-shader-effect-output-name="output.id"><template #label>{{ i18n.ts._ParameterEditor.ReferenceName }}</template></GsInput>
				<GsSelect :modelValue="output.dataType.kind" :items="dataTypeItems" :data-test-custom-shader-effect-output-type="output.id" @update:modelValue="updateOutputType(output.id, $event)"><template #label>{{ i18n.ts._ParameterEditor.DataType }}</template></GsSelect>
				<div :class="$style.actions">
					<GsButton :disabled="index === 0" icon="ti ti-arrow-up" @click="move(draft.outputDefs, index, -1)">{{ i18n.ts._CustomShaderEffect.MoveUp }}</GsButton>
					<GsButton :disabled="index === draft.outputDefs.length - 1" icon="ti ti-arrow-down" @click="move(draft.outputDefs, index, 1)">{{ i18n.ts._CustomShaderEffect.MoveDown }}</GsButton>
					<GsButton :data-test-remove-custom-shader-effect-output="output.id" danger icon="ti ti-trash" @click="removeOutput(output.id)">{{ i18n.ts.Delete }}</GsButton>
				</div>
			</div>
		</GsFolder>
		<GsButton data-test-add-custom-shader-effect-output icon="ti ti-plus" @click="addOutput">{{ i18n.ts._CustomShaderEffect.AddOutput }}</GsButton>
	</template>
	<template v-else-if="tab === 'settings'">
		<GsInput v-model="draft.name" data-test-custom-shader-effect-name><template #label>{{ i18n.ts.Name }}</template></GsInput>
		<GsTextarea v-model="draft.description"><template #label>{{ i18n.ts._Project.Description }}</template></GsTextarea>
		<GsSelect v-model="draft.kind" :items="kindItems"><template #label>{{ i18n.ts._CustomShaderEffect.Kind }}</template></GsSelect>
		<GsSelect v-model="draft.primaryInputId" :items="primaryInputItems" data-test-custom-shader-effect-primary-input><template #label>{{ i18n.ts._ParameterEditor.PrimaryInput }}</template></GsSelect>
		<GsSelect v-model="draft.primaryOutputId" :items="primaryOutputItems" data-test-custom-shader-effect-primary-output><template #label>{{ i18n.ts._VisualModule.PrimaryOutput }}</template></GsSelect>
	</template>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { CustomShaderEffectDefinitionError, describeCustomShaderEffectInterface, validateCustomShaderEffectDefinition } from '@gs/subsystems_effect_shared/custom-shader-effect-definition.ts';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsTextarea from './common/GsTextarea.vue';
import GsSelect from './common/GsSelect.vue';
import GsSwitch from './common/GsSwitch.vue';
import GsFolder from './common/GsFolder.vue';
import GsTabs from './common/GsTabs.vue';
import XPublicParameterDefinitionEditor from './XPublicParameterDefinitionEditor.vue';
import type { PublicParameterDefinitionEdit } from '@/types/parameter-edit.ts';
import type { ProjectCustomShaderEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { CustomShaderEffectParameterDefinition } from '@gs/subsystems_effect_shared/custom-shader-effect-definition.ts';
import { i18n } from '@/i18n.ts';

const props = defineProps<{ customShaderEffect: ProjectCustomShaderEffect }>();
const emit = defineEmits<{ apply: [definition: ProjectCustomShaderEffect] }>();
const draft = ref(deepClone(props.customShaderEffect));
const tab = ref('code');
const supportedTypes = ['scalar', 'vector', 'color', 'any'] as const;
const dataTypeItems = supportedTypes.map(kind => ({ value: kind, label: i18n.ts._EffectPicker._DataTypes[kind] }));
const tabs = [
	{ id: 'code', label: 'WGSL' },
	{ id: 'inputs', label: i18n.ts._CustomShaderEffect.Inputs },
	{ id: 'outputs', label: i18n.ts._CustomShaderEffect.Outputs },
	{ id: 'settings', label: i18n.ts.Settings },
];
const kindItems: { value: ProjectCustomShaderEffect['kind']; label: string }[] = [
	{ value: 'modify', label: i18n.ts._CustomShaderEffect.Modify },
	{ value: 'generate', label: i18n.ts._CustomShaderEffect.Generate },
];
const noneItem = { value: null, label: i18n.ts._CustomShaderEffect.None };
const primaryInputItems = computed(() => [noneItem, ...draft.value.paramDefs.filter(parameter => parameter.dataType.kind === 'color').map(parameter => ({ value: parameter.id, label: parameter.ui.label }))]);
const primaryOutputItems = computed(() => [noneItem, ...draft.value.outputDefs.filter(output => output.dataType.kind === 'color').map(output => ({ value: output.id, label: output.label }))]);
const changed = computed(() => !deepEqual(draft.value, props.customShaderEffect));
const interfaceDescription = computed(() => describeCustomShaderEffectInterface(draft.value));
const validationError = computed(() => {
	if (draft.value.name.trim().length === 0) return i18n.ts._CustomShaderEffect.EmptyName;
	try {
		validateCustomShaderEffectDefinition(draft.value);
		return null;
	} catch (error) {
		return error instanceof CustomShaderEffectDefinitionError
			? `${i18n.ts._CustomShaderEffect.Errors[error.reason]}${error.referenceName.length > 0 ? ` (${error.referenceName})` : ''}`
			: String(error);
	}
});

// 別パネルでの適用・Undo/Redoでも、保存済みの定義へドラフトを揃える。
watch(() => props.customShaderEffect, resetDraft);

function resetDraft() {
	draft.value = deepClone(props.customShaderEffect);
}

function apply() {
	if (changed.value && validationError.value == null) emit('apply', deepClone(draft.value));
}

function nextReferenceName(base: string, definitions: { nameForReference: string }[]) {
	let name = base;
	for (let suffix = 2; definitions.some(definition => definition.nameForReference === name); suffix++) name = `${base}${suffix}`;
	return name;
}

function addParameter() {
	draft.value.paramDefs.push({ id: genId(), nameForReference: nextReferenceName('amount', draft.value.paramDefs), canNode: true, dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 0 } });
}

function updateParameter(id: string, changes: PublicParameterDefinitionEdit) {
	const index = draft.value.paramDefs.findIndex(parameter => parameter.id === id);
	const next = { ...draft.value.paramDefs[index], ...changes, id, canNode: true } as CustomShaderEffectParameterDefinition;
	draft.value.paramDefs[index] = next;
	if (draft.value.primaryInputId === id && next.dataType.kind !== 'color') draft.value.primaryInputId = null;
}

function removeParameter(id: string) {
	draft.value.paramDefs = draft.value.paramDefs.filter(parameter => parameter.id !== id);
	draft.value.resolutionInputIds = draft.value.resolutionInputIds.filter(inputId => inputId !== id);
	if (draft.value.primaryInputId === id) draft.value.primaryInputId = null;
}

function setResolutionInput(id: string, enabled: boolean) {
	draft.value.resolutionInputIds = draft.value.resolutionInputIds.filter(inputId => inputId !== id);
	if (enabled) draft.value.resolutionInputIds.push(id);
}

function addOutput() {
	draft.value.outputDefs.push({ id: genId(), nameForReference: nextReferenceName('output', draft.value.outputDefs), label: 'Output', dataType: { kind: 'color' } });
}

function updateOutputType(id: string, kind: TextureDataType['kind']) {
	const output = draft.value.outputDefs.find(definition => definition.id === id)!;
	output.dataType = { kind };
	if (draft.value.primaryOutputId === id && kind !== 'color') draft.value.primaryOutputId = null;
}

function removeOutput(id: string) {
	draft.value.outputDefs = draft.value.outputDefs.filter(output => output.id !== id);
	if (draft.value.primaryOutputId === id) draft.value.primaryOutputId = null;
}

function move<T>(items: T[], index: number, direction: -1 | 1) {
	const destination = index + direction;
	if (destination < 0 || destination >= items.length) return;
	items.splice(destination, 0, items.splice(index, 1)[0]);
}
</script>

<style module lang="scss">
.root {
	padding: 12px;
}

.actions {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 8px;
}

.error {
	color: var(--THEME-error);
	white-space: pre-wrap;
}
</style>
