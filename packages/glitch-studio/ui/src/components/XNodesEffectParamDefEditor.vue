<template>
<XPublicParameterDefinitionEditor :def="def" nodeInputEnabled @update="update" @remove="emit('remove')">
	<GsSwitch v-if="def.canNode && def.dataType.kind === 'color'" :modelValue="primaryInputId === def.id" @update:modelValue="emit('setPrimaryInput', $event ? def.id : null)">{{ i18n.ts._ParameterEditor.PrimaryInput }}</GsSwitch>
	<GsSwitch v-if="def.dataType.kind === 'audioSource'" :modelValue="primaryAudioInputId === def.id" @update:modelValue="emit('setPrimaryAudioInput', $event ? def.id : null)">{{ i18n.ts._ParameterEditor.PrimaryAudioInput }}</GsSwitch>
</XPublicParameterDefinitionEditor>
</template>

<script lang="ts" setup>
import type { NodesEffectParamDef } from '@/types/nodes-effect-view.ts';
import type { PublicParameterDefinitionEdit } from '@/types/parameter-edit.ts';
import XPublicParameterDefinitionEditor from './XPublicParameterDefinitionEditor.vue';
import GsSwitch from './common/GsSwitch.vue';
import { i18n } from '@/i18n.ts';

defineProps<{ primaryInputId: string | null; primaryAudioInputId?: string | null; def: NodesEffectParamDef }>();
const emit = defineEmits<{
	update: [changes: Partial<Omit<NodesEffectParamDef, 'id'>>, mergeKey?: string | null];
	remove: [];
	setPrimaryInput: [inputId: string | null];
	setPrimaryAudioInput: [inputId: string | null];
}>();

function update(changes: PublicParameterDefinitionEdit, mergeKey?: string | null) {
	emit('update', { ...changes, ...changes.nameForReference == null ? {} : { nameForReference: changes.nameForReference } } as Partial<Omit<NodesEffectParamDef, 'id'>>, mergeKey);
}
</script>
