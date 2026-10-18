<template>
<GsFolder asSection defaultOpen :withSpacer="false">
	<template #icon><i class="ti ti-gizmo"></i></template>
	<template #label>{{ i18n.ts.Transform }}</template>
	<div style="padding: 8px 0;">
		<GsVisualParam
			v-for="(def, key) in timelineTransformParamDefs"
			:key="key"
			keyframesEnabled
			:automationGraphEndEnabled="false"
			:availableVariables="LAYER_VAR_DEFS"
			:automationGraphs="layer.automationGraphs"
			:paramPath="[key]"
			:paramDef="def"
			:paramValue="layer.transformParamValues[key] ?? def.defaultValue"
			@edit="emit('edit', $event)"
		/>
	</div>
	<div class="_spacer">
		<GsSwitch :modelValue="layer.forceDisableMotionBlur" @update:modelValue="emit('motionBlur', $event)">
			{{ i18n.ts._TimelineLayer.DisableSubtreeMotionBlur }}
			<template #caption>{{ i18n.ts._TimelineLayer.SubtreeMotionBlurHint }}</template>
		</GsSwitch>
	</div>
</GsFolder>
</template>

<script lang="ts" setup>
import { timelineTransformParamDefs } from '@gs/subsystems_timeline_shared/layers/transform/transform.ts';
import { LAYER_VAR_DEFS } from '@gs/subsystems_timeline_shared/expression.ts';
import GsFolder from './common/GsFolder.vue';
import GsSwitch from './common/GsSwitch.vue';
import GsVisualParam from './GsVisualParam.vue';
import type { ParamEdit } from './GsVisualParam.vue';
import type { TimelineTransformLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { i18n } from '@/i18n.ts';

defineProps<{ layer: TimelineTransformLayer }>();
const emit = defineEmits<{ edit: [event: ParamEdit]; motionBlur: [disabled: boolean] }>();
</script>
