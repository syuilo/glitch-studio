<template>
<XPublicParameterDefinitionEditor :def="def" nodeInputEnabled @update="update" @remove="emit('remove')">
	<GsSwitch v-if="def.canNode && def.dataType.kind === 'color'" :modelValue="primaryInputId === def.id" @update:modelValue="emit('setPrimaryInput', $event ? def.id : null)">{{ i18n.ts._ParameterEditor.PrimaryInput }}</GsSwitch>
	<GsSwitch v-if="def.dataType.kind === 'audioSource'" :modelValue="primaryAudioInputId === def.id" @update:modelValue="emit('setPrimaryAudioInput', $event ? def.id : null)">{{ i18n.ts._ParameterEditor.PrimaryAudioInput }}</GsSwitch>
</XPublicParameterDefinitionEditor>
</template>

<script lang="ts" setup>
import { visualModulePublicParameterName } from '@gs/subsystems_visual-module_shared/types.ts';
import type { VisualModulePublicParameterId, VisualModuleParamDef } from '@gs/subsystems_visual-module_shared/types.ts';
import type { PublicParameterDefinitionEdit } from '@/types/parameter-edit.ts';
import XPublicParameterDefinitionEditor from './XPublicParameterDefinitionEditor.vue';
import GsSwitch from './common/GsSwitch.vue';
import { i18n } from '@/i18n.ts';

defineProps<{ primaryInputId: VisualModulePublicParameterId | null; primaryAudioInputId?: VisualModulePublicParameterId | null; def: VisualModuleParamDef }>();
const emit = defineEmits<{
	update: [changes: Partial<Omit<VisualModuleParamDef, 'id'>>, mergeKey?: string | null];
	remove: [];
	setPrimaryInput: [inputId: VisualModulePublicParameterId | null];
	setPrimaryAudioInput: [inputId: VisualModulePublicParameterId | null];
}>();

function update(changes: PublicParameterDefinitionEdit, mergeKey?: string | null) {
	emit('update', { ...changes, ...changes.nameForReference == null ? {} : { nameForReference: visualModulePublicParameterName(changes.nameForReference) } } as Partial<Omit<VisualModuleParamDef, 'id'>>, mergeKey);
}
</script>
