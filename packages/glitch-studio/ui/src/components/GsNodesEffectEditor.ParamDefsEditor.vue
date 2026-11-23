<template>
<div :class="$style.root" class="_gaps_m _spacer">
	<GsFolder v-for="def in nodesEffect.paramDefs" :key="def.id" defaultOpen>
		<template #label>{{ def.ui.label }}</template>
		<template #suffix>
			<template v-if="nodesEffect.primaryInputId === def.id">{{ i18n.ts._NodesEffect.Primary }}</template>
		</template>

		<div>
			<!-- TODO: struct / array / anyの公開パラメータ定義編集UI。共通の型定義からは除外しない。 -->
			<div v-if="def.dataType.kind === 'struct' || def.dataType.kind === 'array' || def.dataType.kind === 'any'">{{ def.ui.label }}{{ i18n.ts._TimelineLayer.EditingUnsupported }}</div>
			<XNodesEffectParamDefEditor
				v-else
				:primaryInputId="nodesEffect.primaryInputId"
				:primaryAudioInputId="nodesEffect.primaryAudioInputId"
				:def="def"
				@update="(changes, mergeKey) => emit('update', def.id, changes, mergeKey)"
				@remove="emit('remove', def.id)"
				@setPrimaryInput="emit('setPrimaryInput', $event)"
				@setPrimaryAudioInput="emit('setPrimaryAudioInput', $event)"
			/>
		</div>
	</GsFolder>
	<GsButton large style="width: 100%;" icon="ti ti-plus" @click="add">{{ i18n.ts._NodesEffect.AddParameter }}</GsButton>
</div>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.ts';
import { genId } from '@gs/shared/utility/id.js';
import GsButton from './common/GsButton.vue';
import XNodesEffectParamDefEditor from './XNodesEffectParamDefEditor.vue';
import GsFolder from './common/GsFolder.vue';
import type { NodesEffect, NodesEffectParamDef } from '@/types/nodes-effect-view.ts';

const props = defineProps<{
	nodesEffect: NodesEffect;
}>();

const emit = defineEmits<{
	add: [def: NodesEffectParamDef];
	update: [defId: string, changes: Partial<Omit<NodesEffectParamDef, 'id'>>, mergeKey?: string | null];
	remove: [defId: string];
	setPrimaryInput: [inputId: string | null];
	setPrimaryAudioInput: [inputId: string | null];
}>();

function add() {
	let nameForReference = 'my_param';
	for (let suffix = 2; props.nodesEffect.paramDefs.some(def => def.nameForReference === nameForReference); suffix++) nameForReference = `my_param_${suffix}`;
	emit('add', {
		id: genId(),
		nameForReference: nameForReference,
		dataType: { kind: 'scalar' },
		ui: {
			label: 'My Parameter',
			control: {
				controlType: 'range',
				min: 0,
				max: 1,
				step: 0.01,
			},
		},
		defaultValue: 0.5,
		canNode: false,
	});
}

</script>

<style module lang="scss">
.root {

}

</style>
