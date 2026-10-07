<template>
<GsFolder asSection defaultOpen :withSpacer="false">
	<template #icon><i class="ti ti-shape"></i></template>
	<template #label>Shape: {{ shapeDefinitions[layer.shape.type].label }}</template>
	<div class="_spacer" style="font-size: 0.85em; opacity: 0.7;">
		<div>Size, stroke width, and corner radius use the scene height as 1.</div>
		<div>Stroke start runs clockwise: top 0/1, right 0.25, bottom 0.5, left 0.75.</div>
	</div>
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
import { getShapeParameterDefinitions, shapeDefinitions } from '@gs/subsystems_timeline_shared/layers/shape/shape.ts';
import { LAYER_VAR_DEFS } from '@gs/subsystems_timeline_shared/expression.ts';
import GsFolder from './common/GsFolder.vue';
import GsVisualParam from './GsVisualParam.vue';
import type { ParamEdit } from './GsVisualParam.vue';
import type { TimelineShapeLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';

const props = defineProps<{ layer: TimelineShapeLayer }>();
const emit = defineEmits<{ edit: [event: ParamEdit] }>();
const definitions = computed(() => getShapeParameterDefinitions(props.layer.shape.type));
const values = computed<Record<string, ValueParameterBinding>>(() => props.layer.shape.paramValues);
</script>
