<template>
<div :class="$style.root">
	<div v-for="def in visualModule.paramDefs" :key="def.id">
		<XVisualModuleParamDefEditor :def="def"/>
	</div>
	<GsButton @click="add">Add parameter</GsButton>
</div>
</template>

<script lang="ts" setup>
import { genId } from '@glitch/shared/utility/id.js';
import GsSelect from './common/GsSelect.vue';
import GsInput from './common/GsInput.vue';
import GsButton from './common/GsButton.vue';
import XVisualModuleParamDefEditor from './XVisualModuleParamDefEditor.vue';
import type { GsGroupNode, VisualModule } from '@glitch/shared/types.ts';
import { appContext } from '@/app.ts';
import { i18n } from '@/i18n.ts';

const props = defineProps<{
	visualModule: VisualModule;
}>();

function add() {
	appContext.commit('addVisualModuleParamDef', {
		visualModuleId: props.visualModule.id,
		def: {
			id: genId(),
			label: 'My Parameter',
			name: 'myParam',
			type: 'range',
			typeOptions: {
				min: 0,
				max: 1,
				step: 0.01,
			},
			defaultValue: 0.5,
			canNode: true,
			isPrimaryInput: true,
		},
	});
}

</script>

<style module lang="scss">
.root {

}

</style>
