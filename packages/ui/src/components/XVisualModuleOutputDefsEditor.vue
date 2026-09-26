<template>
<div class="_gaps_s">
	<div v-for="def in visualModule.outputDefs" :key="def.id" :class="$style.definition">
		<span>Label</span>
		<GsInput :modelValue="def.label" @update:modelValue="update(def.id, { label: $event })"/>
		<span>Name</span>
		<GsInput :modelValue="def.name" @update:modelValue="update(def.id, { name: $event })"/>
		<GsSelect :modelValue="def.dataType.kind" :items="dataTypes" @update:modelValue="update(def.id, { dataType: { kind: $event }, isPrimaryOutput: $event === 'color' && def.isPrimaryOutput })"/>
		<GsSwitch
			v-if="def.dataType.kind === 'color'"
			:modelValue="def.isPrimaryOutput"
			:disabled="!def.isPrimaryOutput && visualModule.outputDefs.some(item => item.isPrimaryOutput)"
			@update:modelValue="update(def.id, { isPrimaryOutput: $event })"
		>Primary output</GsSwitch>
		<GsButton small danger @click="appContext.commit('removeVisualModuleOutputDef', { visualModuleId: visualModule.id, defId: def.id })">Remove output</GsButton>
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
import { appContext } from '@/app.ts';

type OutputDef = VisualModule['outputDefs'][number];
const props = defineProps<{ visualModule: VisualModule }>();
const dataTypes: { label: string; value: OutputDef['dataType']['kind'] }[] = [
	{ label: 'Color', value: 'color' },
	{ label: 'Scalar', value: 'scalar' },
	{ label: 'Vector', value: 'vector' },
	{ label: 'Any', value: 'any' },
];

function update(defId: string, changes: Partial<Omit<OutputDef, 'id'>>) {
	appContext.commit('updateVisualModuleOutputDef', { visualModuleId: props.visualModule.id, defId, changes });
}

function add() {
	let name = 'output';
	for (let suffix = 2; props.visualModule.outputDefs.some(def => def.name === name); suffix++) name = `output${suffix}`;
	appContext.commit('addVisualModuleOutputDef', {
		visualModuleId: props.visualModule.id,
		def: { id: genId(), label: 'Output', name, dataType: { kind: 'color' }, isPrimaryOutput: !props.visualModule.outputDefs.some(def => def.isPrimaryOutput) },
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
