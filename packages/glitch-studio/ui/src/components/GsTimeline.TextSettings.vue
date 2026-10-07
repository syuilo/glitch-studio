<template>
<GsFolder asSection defaultOpen :withSpacer="false">
	<template #icon><i class="ti ti-typography"></i></template>
	<template #label>Text</template>
	<div style="padding: 8px 0;">
		<GsVisualParam
			v-for="[key, def] in Object.entries(definitions)"
			:key="key"
			keyframesEnabled
			:automationGraphEndEnabled="false"
			:availableVariables="LAYER_VAR_DEFS"
			:automationGraphs="layer.automationGraphs"
			:paramPath="[key]"
			:paramDef="def"
			:paramValue="values[key] ?? def.defaultValue"
			@edit="emit('edit', $event)"
		/>
	</div>
</GsFolder>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { textParamDefs } from '@gs/subsystems_timeline_shared/layers/text/text.ts';
import { LAYER_VAR_DEFS } from '@gs/subsystems_timeline_shared/expression.ts';
import GsFolder from './common/GsFolder.vue';
import GsVisualParam from './GsVisualParam.vue';
import type { ParamEdit } from './GsVisualParam.vue';
import type { TimelineTextLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';

const props = defineProps<{ layer: TimelineTextLayer }>();
const emit = defineEmits<{ edit: [event: ParamEdit] }>();
const definitions = textParamDefs;
const values = computed<Record<string, ValueParameterBinding>>(() => props.layer.textParamValues);
</script>
