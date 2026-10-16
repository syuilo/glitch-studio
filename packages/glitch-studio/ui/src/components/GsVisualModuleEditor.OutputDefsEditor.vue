<template>
<div class="_gaps_m _spacer">
	<GsFolder v-for="def in visualModule.outputDefs" :key="def.id" defaultOpen>
		<template #label>{{ def.label }}</template>

		<div class="_gaps_s _spacer">
			<span>{{ i18n.ts.Label }}</span>
			<GsInput :modelValue="def.label" @update:modelValue="update(def.id, { label: $event })"/>
			<span>{{ i18n.ts.Name }}</span>
			<GsInput :modelValue="def.name" @update:modelValue="update(def.id, { name: $event })"/>
			<GsSelect :modelValue="def.dataType.kind" :items="dataTypes" @update:modelValue="update(def.id, { dataType: { kind: $event } })"/>
			<GsSwitch
				v-if="def.dataType.kind === 'color'"
				:modelValue="visualModule.primaryOutputId === def.id"
				:disabled="visualModule.primaryOutputId != null && visualModule.primaryOutputId !== def.id"
				@update:modelValue="emit('setPrimaryOutput', $event ? def.id : null)"
			>
				{{ i18n.ts._VisualModule.PrimaryOutput }}
			</GsSwitch>
			<GsButton small danger @click="emit('remove', def.id)">{{ i18n.ts._VisualModule.RemoveOutput }}</GsButton>
		</div>
	</GsFolder>
	<GsButton style="width: 100%;" @click="add"><i class="ti ti-plus"></i> {{ i18n.ts._VisualModule.AddOutput }}</GsButton>
</div>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.ts';
import { genId } from '@gs/shared/utility/id.js';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import GsSwitch from './common/GsSwitch.vue';
import GsButton from './common/GsButton.vue';
import GsFolder from './common/GsFolder.vue';
import type { VisualModule, VisualModuleOutputDef } from '@gs/subsystems_visual-module_shared/types.ts';

type OutputDef = VisualModuleOutputDef;
const props = defineProps<{ visualModule: VisualModule }>();
const emit = defineEmits<{
	add: [def: OutputDef];
	update: [defId: string, changes: Partial<Omit<OutputDef, 'id'>>];
	remove: [defId: string];
	setPrimaryOutput: [outputId: string | null];
}>();
const dataTypes: { label: string; value: OutputDef['dataType']['kind'] }[] = [
	{ label: i18n.ts.Color, value: 'color' },
	{ label: i18n.ts._EffectPicker._DataTypes.scalar, value: 'scalar' },
	{ label: i18n.ts._EffectPicker._DataTypes.vector, value: 'vector' },
	{ label: i18n.ts._EffectPicker._DataTypes.any, value: 'any' },
];

function update(defId: string, changes: Partial<Omit<OutputDef, 'id'>>) {
	emit('update', defId, changes);
}

function add() {
	let name = 'output';
	for (let suffix = 2; props.visualModule.outputDefs.some(def => def.name === name); suffix++) name = `output${suffix}`;
	emit('add', { id: genId(), label: 'Output', name, dataType: { kind: 'color' } });
}
</script>

<style module lang="scss">

</style>
