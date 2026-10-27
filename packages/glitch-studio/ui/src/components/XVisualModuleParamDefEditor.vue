<template>
<XCustomParameterDefinitionEditor :def="def" nodeInputEnabled @update="update" @remove="emit('remove')">
	<GsSwitch v-if="def.canNode && def.dataType.kind === 'color'" :modelValue="primaryInputId === def.id" @update:modelValue="emit('setPrimaryInput', $event ? def.id : null)">{{ i18n.ts._ParameterEditor.PrimaryInput }}</GsSwitch>
	<GsSwitch v-if="def.dataType.kind === 'audioSource'" :modelValue="primaryAudioInputId === def.id" @update:modelValue="emit('setPrimaryAudioInput', $event ? def.id : null)">{{ i18n.ts._ParameterEditor.PrimaryAudioInput }}</GsSwitch>
</XCustomParameterDefinitionEditor>
</template>

<script lang="ts" setup>
import { visualModuleCustomParameterName } from '@gs/subsystems_visual-module_shared/types.ts';
import type { VisualModuleCustomParameterId, VisualModuleParamDef } from '@gs/subsystems_visual-module_shared/types.ts';
import type { CustomParameterDefinitionEdit } from '@/types/parameter-edit.ts';
import XCustomParameterDefinitionEditor from './XCustomParameterDefinitionEditor.vue';
import GsSwitch from './common/GsSwitch.vue';
import { i18n } from '@/i18n.ts';

defineProps<{ primaryInputId: VisualModuleCustomParameterId | null; primaryAudioInputId?: VisualModuleCustomParameterId | null; def: VisualModuleParamDef }>();
const emit = defineEmits<{
	update: [changes: Partial<Omit<VisualModuleParamDef, 'id'>>, mergeKey?: string | null];
	remove: [];
	setPrimaryInput: [inputId: VisualModuleCustomParameterId | null];
	setPrimaryAudioInput: [inputId: VisualModuleCustomParameterId | null];
}>();

function update(changes: CustomParameterDefinitionEdit, mergeKey?: string | null) {
	emit('update', { ...changes, ...changes.nameForReference == null ? {} : { nameForReference: visualModuleCustomParameterName(changes.nameForReference) } } as Partial<Omit<VisualModuleParamDef, 'id'>>, mergeKey);
}
</script>
