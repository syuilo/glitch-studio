<template>
<div :class="$style.root" class="_gaps_m _spacer">
	<GsFolder v-for="def in customNodeGraphEffect.paramDefs" :key="def.id" defaultOpen>
		<template #label>{{ def.ui.label }}</template>
		<template #suffix>
			<template v-if="customNodeGraphEffect.primaryInputId === def.id">{{ i18n.ts._CustomNodeGraphEffect.Primary }}</template>
		</template>

		<div>
			<!-- TODO: struct / array / anyの公開パラメータ定義編集UI。共通の型定義からは除外しない。 -->
			<div v-if="def.dataType.kind === 'struct' || def.dataType.kind === 'array' || def.dataType.kind === 'any'">{{ def.ui.label }}{{ i18n.ts._TimelineLayer.EditingUnsupported }}</div>
			<XCustomNodeGraphEffectParamDefEditor
				v-else
				:primaryInputId="customNodeGraphEffect.primaryInputId"
				:primaryAudioInputId="customNodeGraphEffect.primaryAudioInputId"
				:def="def"
				@update="(changes, mergeKey) => emit('update', def.id, changes, mergeKey)"
				@remove="emit('remove', def.id)"
				@setPrimaryInput="emit('setPrimaryInput', $event)"
				@setPrimaryAudioInput="emit('setPrimaryAudioInput', $event)"
			/>
		</div>
	</GsFolder>
	<GsButton large style="width: 100%;" icon="ti ti-plus" @click="add">{{ i18n.ts._CustomNodeGraphEffect.AddParameter }}</GsButton>
</div>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.ts';
import { customNodeGraphEffectPublicParameterId, customNodeGraphEffectPublicParameterName } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import { genId } from '@gs/shared/utility/id.js';
import GsButton from './common/GsButton.vue';
import XCustomNodeGraphEffectParamDefEditor from './XCustomNodeGraphEffectParamDefEditor.vue';
import GsFolder from './common/GsFolder.vue';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectPublicParameterId, CustomNodeGraphEffectParamDef } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';

const props = defineProps<{
	customNodeGraphEffect: CustomNodeGraphEffect;
}>();

const emit = defineEmits<{
	add: [def: CustomNodeGraphEffectParamDef];
	update: [defId: CustomNodeGraphEffectPublicParameterId, changes: Partial<Omit<CustomNodeGraphEffectParamDef, 'id'>>, mergeKey?: string | null];
	remove: [defId: CustomNodeGraphEffectPublicParameterId];
	setPrimaryInput: [inputId: CustomNodeGraphEffectPublicParameterId | null];
	setPrimaryAudioInput: [inputId: CustomNodeGraphEffectPublicParameterId | null];
}>();

function add() {
	let nameForReference = 'my_param';
	for (let suffix = 2; props.customNodeGraphEffect.paramDefs.some(def => def.nameForReference === nameForReference); suffix++) nameForReference = `my_param_${suffix}`;
	emit('add', {
		id: customNodeGraphEffectPublicParameterId(genId()),
		nameForReference: customNodeGraphEffectPublicParameterName(nameForReference),
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
		defaultValue: { inputSource: 'literal', value: 0.5 },
		canNode: false,
	});
}

</script>

<style module lang="scss">
.root {

}

</style>
