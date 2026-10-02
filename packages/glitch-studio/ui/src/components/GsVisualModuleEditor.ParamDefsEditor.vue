<template>
<div :class="$style.root" class="_gaps_m _spacer">
	<GsFolder v-for="def in visualModule.paramDefs" :key="def.id" defaultOpen>
		<template #label>{{ def.ui.label }}</template>
		<template #suffix>
			<template v-if="visualModule.primaryInputId === def.id">Primary</template>
		</template>

		<div>
			<!-- TODO: struct / array / anyのカスタムパラメータ定義編集UI。共通の型定義からは除外しない。 -->
			<div v-if="def.dataType.kind === 'struct' || def.dataType.kind === 'array' || def.dataType.kind === 'any'">{{ def.ui.label }}: Editing is not yet supported.</div>
			<XVisualModuleParamDefEditor
				v-else
				:primaryInputId="visualModule.primaryInputId"
				:def="def"
				@update="(changes, mergeKey) => emit('update', def.id, changes, mergeKey)"
				@remove="emit('remove', def.id)"
				@setPrimaryInput="emit('setPrimaryInput', $event)"
			/>
		</div>
	</GsFolder>
	<GsButton style="width: 100%;" @click="add"><i class="ti ti-plus"></i> Add Parameter</GsButton>
</div>
</template>

<script lang="ts" setup>
import { visualModuleCustomParameterId, visualModuleCustomParameterName } from '@gs/shared/visual-module/types.ts';
import { genId } from '@gs/shared/utility/id.js';
import GsButton from './common/GsButton.vue';
import XVisualModuleParamDefEditor from './XVisualModuleParamDefEditor.vue';
import GsFolder from './common/GsFolder.vue';
import type { VisualModule, VisualModuleCustomParameterId, VisualModuleParamDef } from '@gs/shared/visual-module/types.ts';

const props = defineProps<{
	visualModule: VisualModule;
}>();

const emit = defineEmits<{
	add: [def: VisualModuleParamDef];
	update: [defId: VisualModuleCustomParameterId, changes: Partial<Omit<VisualModuleParamDef, 'id'>>, mergeKey?: string | null];
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
