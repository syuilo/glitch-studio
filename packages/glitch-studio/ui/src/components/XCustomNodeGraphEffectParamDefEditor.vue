<template>
<XPublicParameterDefinitionEditor :def="def" nodeInputEnabled @update="update" @remove="emit('remove')">
	<GsSwitch v-if="def.canNode && def.dataType.kind === 'color'" :modelValue="primaryInputId === def.id" @update:modelValue="emit('setPrimaryInput', $event ? def.id : null)">{{ i18n.ts._ParameterEditor.PrimaryInput }}</GsSwitch>
	<GsSwitch v-if="def.dataType.kind === 'audioSource'" :modelValue="primaryAudioInputId === def.id" @update:modelValue="emit('setPrimaryAudioInput', $event ? def.id : null)">{{ i18n.ts._ParameterEditor.PrimaryAudioInput }}</GsSwitch>
</XPublicParameterDefinitionEditor>
</template>

<script lang="ts" setup>
import { customNodeGraphEffectPublicParameterName } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import type { CustomNodeGraphEffectPublicParameterId, CustomNodeGraphEffectParamDef } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import type { PublicParameterDefinitionEdit } from '@/types/parameter-edit.ts';
import XPublicParameterDefinitionEditor from './XPublicParameterDefinitionEditor.vue';
import GsSwitch from './common/GsSwitch.vue';
import { i18n } from '@/i18n.ts';

defineProps<{ primaryInputId: CustomNodeGraphEffectPublicParameterId | null; primaryAudioInputId?: CustomNodeGraphEffectPublicParameterId | null; def: CustomNodeGraphEffectParamDef }>();
const emit = defineEmits<{
	update: [changes: Partial<Omit<CustomNodeGraphEffectParamDef, 'id'>>, mergeKey?: string | null];
	remove: [];
	setPrimaryInput: [inputId: CustomNodeGraphEffectPublicParameterId | null];
	setPrimaryAudioInput: [inputId: CustomNodeGraphEffectPublicParameterId | null];
}>();

function update(changes: PublicParameterDefinitionEdit, mergeKey?: string | null) {
	emit('update', { ...changes, ...changes.nameForReference == null ? {} : { nameForReference: customNodeGraphEffectPublicParameterName(changes.nameForReference) } } as Partial<Omit<CustomNodeGraphEffectParamDef, 'id'>>, mergeKey);
}
</script>
