<template>
<div class="_spacer _gaps_m" data-test-visual-module-custom-parameters>
	<GsFolder v-for="definition in visualModule.customParameterDefs" :key="definition.id" defaultOpen :data-test-custom-parameter="definition.id">
		<template #label>{{ definition.ui.label }}</template>
		<GsVisualParam
			keyframesEnabled visualModuleParameterReferencesEnabled
			:availableVariables="VISUAL_MODULE_CUSTOM_PARAMETER_VAR_DEFS"
			:automationGraphs="visualModule.automationGraphs"
			:visualModule="visualModule"
			:paramPath="[definition.id]"
			:paramDef="definition"
			:paramValue="visualModule.customParameterValues[definition.id] ?? definition.defaultValue"
			:data-test-custom-parameter-value="definition.id"
			@edit="event => editValue(definition.id, event)"
		/>
		<GsInlineKeyframesEditor
			v-if="keyframesBinding(definition.id) != null" :definition="definition" :binding="keyframesBinding(definition.id)!"
			@update="(value, mergeKey) => editValue(definition.id, { kind: 'keyframesTimelineInline', value, paramPath: [definition.id], mergeKey })"
		/>
		<GsFolder>
			<template #label>{{ i18n.ts._ParameterEditor.Definition }}</template>
			<XPublicParameterDefinitionEditor :def="definition" :supportedTypes="VISUAL_MODULE_CUSTOM_PARAMETER_TYPES" :data-test-custom-parameter-definition="definition.id" @update="(changes, mergeKey) => update(definition, changes, mergeKey)" @remove="emit('edit', { kind: 'removeCustomParameter', parameterId: definition.id })">
				<div v-if="definitionErrors.get(definition.id) != null" data-test-custom-parameter-error style="color: var(--THEME-error);">{{ definitionErrors.get(definition.id) }}</div>
			</XPublicParameterDefinitionEditor>
		</GsFolder>
	</GsFolder>
	<GsButton data-test-add-custom-parameter icon="ti ti-plus" @click="add">{{ i18n.ts._VisualModule.AddParameter }}</GsButton>
</div>
</template>

<script lang="ts" setup>
import { reactive } from 'vue';
import { genId } from '@gs/shared/utility/id.ts';
import { visualModuleCustomParameterId, visualModuleCustomParameterName } from '@gs/subsystems_visual-module_shared/types.ts';
import { VISUAL_MODULE_CUSTOM_PARAMETER_VAR_DEFS } from '@gs/subsystems_visual-module_shared/expression.ts';
import { VISUAL_MODULE_CUSTOM_PARAMETER_TYPES, validateVisualModuleCustomParameterDefinition } from '@gs/subsystems_visual-module_shared/custom-parameters.ts';
import type { VisualModule, VisualModuleCustomParameterDefinition, VisualModuleCustomParameterId } from '@gs/subsystems_visual-module_shared/types.ts';
import type { VisualModuleEdit } from '@/types/visual-module-editor.ts';
import type { PublicParameterDefinitionEdit } from '@/types/parameter-edit.ts';
import type { ParamEdit } from './GsVisualParam.vue';
import GsVisualParam from './GsVisualParam.vue';
import GsInlineKeyframesEditor from './GsInlineKeyframesEditor.vue';
import XPublicParameterDefinitionEditor from './XPublicParameterDefinitionEditor.vue';
import GsFolder from './common/GsFolder.vue';
import GsButton from './common/GsButton.vue';
import { i18n } from '@/i18n.ts';

const props = defineProps<{ visualModule: VisualModule }>();
const emit = defineEmits<{ edit: [event: VisualModuleEdit] }>();
const definitionErrors = reactive(new Map<VisualModuleCustomParameterId, string>());

function keyframesBinding(id: VisualModuleCustomParameterId) {
	const binding = props.visualModule.customParameterValues[id];
	return binding?.inputSource === 'keyframesTimelineInline' ? binding : null;
}

function add() {
	let nameForReference = 'my_param';
	for (let suffix = 2; props.visualModule.customParameterDefs.some(definition => definition.nameForReference === nameForReference); suffix++) nameForReference = `my_param_${suffix}`;
	emit('edit', { kind: 'updateCustomParameter', definition: {
		id: visualModuleCustomParameterId(genId()), nameForReference: visualModuleCustomParameterName(nameForReference), canNode: false,
		dataType: { kind: 'scalar' }, ui: { label: nameForReference, control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.5 },
	} });
}

function update(definition: VisualModuleCustomParameterDefinition, changes: PublicParameterDefinitionEdit, mergeKey?: string | null) {
	const next = { ...definition, ...changes, nameForReference: changes.nameForReference == null ? definition.nameForReference : visualModuleCustomParameterName(changes.nameForReference), canNode: false } as VisualModuleCustomParameterDefinition;
	try {
		validateVisualModuleCustomParameterDefinition(next);
		if (props.visualModule.customParameterDefs.some(candidate => candidate.id !== next.id && candidate.nameForReference === next.nameForReference)) throw new Error(i18n.ts._Parameter.DuplicateCustomParameterName);
	} catch (error) {
		definitionErrors.set(definition.id, error instanceof Error ? error.message : String(error));
		return;
	}
	definitionErrors.delete(definition.id);
	emit('edit', { kind: 'updateCustomParameter', definition: next, mergeKey });
}

function editValue(parameterId: VisualModuleCustomParameterId, event: ParamEdit) {
	switch (event.kind) {
		case 'copy':
		case 'paste': emit('edit', { kind: 'customParameterClipboard', parameterId, operation: event.kind }); return;
		case 'createPublicParameter':
		case 'createCustomParameter':
		case 'node':
		case 'anotherLayerOutput':
		case 'lowerLayerOutput':
		case 'anotherLayerAudio':
		case 'timelineLayerPublicParameterReference': return;
		case 'inputSource':
			if (event.inputSource === 'node' || event.inputSource === 'anotherLayerOutput' || event.inputSource === 'lowerLayerOutput' || event.inputSource === 'lowerLayerAudio' || event.inputSource === 'anotherLayerAudio' || event.inputSource === 'timelineLayerPublicParameterReference') return;
			emit('edit', { kind: 'editCustomParameter', parameterId, edit: { kind: 'inputSource', inputSource: event.inputSource }, mergeKey: event.mergeKey });
			return;
		default: emit('edit', { kind: 'editCustomParameter', parameterId, edit: event, mergeKey: event.mergeKey });
	}
}
</script>
