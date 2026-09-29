<template>
<div :class="$style.root">
	<div v-for="def in visualModule.paramDefs" :key="def.id">
		<!-- TODO: struct / array / anyのカスタムパラメータ定義編集UI。共通の型定義からは除外しない。 -->
		<div v-if="def.dataType.kind === 'struct' || def.dataType.kind === 'array' || def.dataType.kind === 'any'">{{ def.ui.label }}: Editing is not yet supported.</div>
		<XVisualModuleParamDefEditor
			v-else :primaryInputId="visualModule.primaryInputId" :def="def"
			@update="changes => emit('update', def.id, changes)"
			@remove="emit('remove', def.id)"
			@setPrimaryInput="emit('setPrimaryInput', $event)"
		/>
	</div>
	<GsButton @click="add">Add parameter</GsButton>
</div>
</template>

<script lang="ts" setup>
import { visualModuleCustomParameterId, visualModuleCustomParameterName } from '@glitch/shared/visual-module/types.ts';
import { genId } from '@glitch/shared/utility/id.js';
import GsButton from './common/GsButton.vue';
import XVisualModuleParamDefEditor from './XVisualModuleParamDefEditor.vue';
import type { VisualModule, VisualModuleCustomParameterId, VisualModuleParamDef } from '@glitch/shared/visual-module/types.ts';

const props = defineProps<{
	visualModule: VisualModule;
}>();

const emit = defineEmits<{
	add: [def: VisualModuleParamDef];
	update: [defId: VisualModuleCustomParameterId, changes: Partial<Omit<VisualModuleParamDef, 'id'>>];
	remove: [defId: VisualModuleCustomParameterId];
	setPrimaryInput: [inputId: VisualModuleCustomParameterId | null];
}>();

function add() {
	let name = 'myParam';
	for (let suffix = 2; props.visualModule.paramDefs.some(def => def.nameForReference === name); suffix++) name = `myParam${suffix}`;
	emit('add', {
		id: visualModuleCustomParameterId(genId()),
		nameForReference: visualModuleCustomParameterName(name),
		dataType: { kind: 'scalar' },
		ui: { label: 'My Parameter', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
		defaultValue: { inputSource: 'literal', value: 0.5 },
		canNode: false,
	});
}

</script>

<style module lang="scss">
.root {

}

</style>
