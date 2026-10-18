<template>
<GsFolder asSection defaultOpen :withSpacer="false">
	<template #icon><i class="ti ti-camera"></i></template>
	<template #label>{{ i18n.ts.Camera }}</template>
	<div style="padding: 8px 0;">
		<GsVisualParam
			v-for="(def, key) in timelineCameraParamDefs"
			:key="key"
			keyframesEnabled
			:automationGraphEndEnabled="false"
			:availableVariables="LAYER_VAR_DEFS"
			:automationGraphs="layer.automationGraphs"
			:paramPath="[key]"
			:paramDef="def"
			:paramValue="layer.cameraParamValues[key] ?? def.defaultValue"
			@edit="emit('edit', $event)"
		/>
	</div>
	<div class="_spacer">
		<GsSwitch :modelValue="layer.forceDisableMotionBlur" @update:modelValue="emit('motionBlur', $event)">
			{{ i18n.ts._TimelineLayer.DisableCameraMotionBlur }}
			<template #caption>{{ i18n.ts._TimelineLayer.CameraMotionBlurHint }}</template>
		</GsSwitch>
	</div>
</GsFolder>
</template>

<script lang="ts" setup>
import { timelineCameraParamDefs } from '@gs/subsystems_timeline_shared/layers/camera/camera.ts';
import { LAYER_VAR_DEFS } from '@gs/subsystems_timeline_shared/expression.ts';
import GsFolder from './common/GsFolder.vue';
import GsSwitch from './common/GsSwitch.vue';
import GsVisualParam from './GsVisualParam.vue';
import type { ParamEdit } from './GsVisualParam.vue';
import type { TimelineCameraLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { i18n } from '@/i18n.ts';

defineProps<{ layer: TimelineCameraLayer }>();
const emit = defineEmits<{ edit: [event: ParamEdit]; motionBlur: [disabled: boolean] }>();
</script>
