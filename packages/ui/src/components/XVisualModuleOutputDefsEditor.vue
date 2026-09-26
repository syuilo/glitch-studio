<template>
<div class="_gaps_s">
	<div v-for="def in visualModule.outputDefs" :key="def.id" :class="$style.definition">
		<span>Label</span>
		<GsInput :modelValue="def.label" @update:modelValue="update(def.id, { label: $event })"/>
		<span>Name</span>
		<GsInput :modelValue="def.name" @update:modelValue="update(def.id, { name: $event })"/>
		<GsSelect :modelValue="def.dataType.kind" :items="dataTypes" @update:modelValue="update(def.id, { dataType: { kind: $event } })"/>
		<GsSwitch
			v-if="def.dataType.kind === 'color'"
			:modelValue="visualModule.primaryOutputId === def.id"
			:disabled="visualModule.primaryOutputId !== null && visualModule.primaryOutputId !== def.id"
			@update:modelValue="appStateManager.commit('setVisualModulePrimaryOutput', { visualModuleId: visualModule.id, primaryOutputId: $event ? def.id : null })"
		>Primary output</GsSwitch>
		<GsButton small danger @click="appStateManager.commit('removeVisualModuleOutputDef', { visualModuleId: visualModule.id, defId: def.id })">Remove output</GsButton>
	</div>
	<GsButton small @click="add">Add output</GsButton>
</div>
</template>

<script lang="ts" setup>
import { genId } from '@glitch/shared/utility/id.js';
import type { VisualModule } from '@glitch/shared/visual-module/types.ts';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import GsSwitch from './common/GsSwitch.vue';
import GsButton from './common/GsButton.vue';
import { appStateManager } from '@/app.ts';

type OutputDef = VisualModule['outputDefs'][number];
const props = defineProps<{ visualModule: VisualModule }>();
const dataTypes: { label: string; value: OutputDef['dataType']['kind'] }[] = [
	{ label: 'Color', value: 'color' },
	{ label: 'Scalar', value: 'scalar' },
	{ label: 'Vector', value: 'vector' },
	{ label: 'Any', value: 'any' },
];

function update(defId: string, changes: Partial<Omit<OutputDef, 'id'>>) {
	appStateManager.commit('updateVisualModuleOutputDef', { visualModuleId: props.visualModule.id, defId, changes });
}

function add() {
	let name = 'output';
	for (let suffix = 2; props.visualModule.outputDefs.some(def => def.name === name); suffix++) name = `output${suffix}`;
	appStateManager.commit('addVisualModuleOutputDef', {
		visualModuleId: props.visualModule.id,
		def: { id: genId(), label: 'Output', name, dataType: { kind: 'color' } },
	});
}
</script>

<style module lang="scss">
.definition {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 8px 0;
}
</style>
