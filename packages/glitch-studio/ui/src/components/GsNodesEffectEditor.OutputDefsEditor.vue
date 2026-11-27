<template>
<div class="_gaps_m _spacer">
	<GsFolder v-for="def in nodesEffect.outputDefs" :key="def.id" defaultOpen>
		<template #label>{{ def.label }}</template>

		<div class="_gaps_m">
			<GsInput :modelValue="def.label" @update:modelValue="update(def.id, { label: $event })">
				<template #label>{{ i18n.ts.Label }}</template>
			</GsInput>
			<GsInput :modelValue="def.name" @update:modelValue="update(def.id, { name: $event })">
				<template #label>{{ i18n.ts.Name }}</template>
			</GsInput>
			<GsSelect :modelValue="def.dataType.kind" :items="dataTypes" @update:modelValue="update(def.id, { dataType: { kind: $event } })"/>
			<GsSwitch
				v-if="def.dataType.kind === 'color'"
				:modelValue="nodesEffect.primaryOutputId === def.id"
				:disabled="nodesEffect.primaryOutputId != null && nodesEffect.primaryOutputId !== def.id"
				@update:modelValue="emit('setPrimaryOutput', $event ? def.id : null)"
			>
				{{ i18n.ts._NodesEffect.PrimaryOutput }}
			</GsSwitch>
			<GsButton danger @click="emit('remove', def.id)">{{ i18n.ts._NodesEffect.RemoveOutput }}</GsButton>
		</div>
	</GsFolder>
	<GsButton large style="width: 100%;" icon="ti ti-plus" @click="add">{{ i18n.ts._NodesEffect.AddOutput }}</GsButton>
</div>
</template>

<script lang="ts" setup>
import { genId } from '@gs/shared/utility/id.js';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import GsSwitch from './common/GsSwitch.vue';
import GsButton from './common/GsButton.vue';
import GsFolder from './common/GsFolder.vue';
import type { NodesEffect, NodesEffectOutputDef } from '@/types/nodes-effect-view.ts';
import { i18n } from '@/i18n.ts';

type OutputDef = NodesEffectOutputDef;
const props = defineProps<{ nodesEffect: NodesEffect }>();
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
	for (let suffix = 2; props.nodesEffect.outputDefs.some(def => def.name === name); suffix++) name = `output${suffix}`;
	emit('add', {
		id: genId(),
		label: 'Output',
		name,
		dataType: { kind: 'color' },
	});
}
</script>

<style module lang="scss">

</style>
