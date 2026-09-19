<template>
<div :class="$style.root">
	<div v-for="def in visualModule.paramDefs" :key="def.id">
		<XVisualModuleParamDefEditor :visualModuleId="visualModule.id" :def="def"/>
	</div>
	<GsButton @click="add">Add parameter</GsButton>
</div>
</template>

<script lang="ts" setup>
import { genId } from '@glitch/shared/utility/id.js';
import GsButton from './common/GsButton.vue';
import XVisualModuleParamDefEditor from './XVisualModuleParamDefEditor.vue';
import type { VisualModule } from '@glitch/shared/types.ts';
import { appContext } from '@/app.ts';

const props = defineProps<{
	visualModule: VisualModule;
}>();

function add() {
	let name = 'myParam';
	for (let suffix = 2; props.visualModule.paramDefs.some(def => def.name === name); suffix++) name = `myParam${suffix}`;
	appContext.commit('addVisualModuleParamDef', {
		visualModuleId: props.visualModule.id,
		def: {
			id: genId(),
			label: 'My Parameter',
			name,
			type: 'range',
			typeOptions: {
				min: 0,
				max: 1,
				step: 0.01,
			},
			defaultValue: 0.5,
			canNode: true,
			isPrimaryInput: false,
		},
	});
}

</script>

<style module lang="scss">
.root {

}

</style>
