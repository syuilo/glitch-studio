<template>
<GsFolder asSection defaultOpen :withSpacer="false">
	<template #icon><i class="ti ti-typography"></i></template>
	<template #label>{{ i18n.ts.Text }}</template>
	<div style="padding: 8px 0;">
		<GsStaticSettings :definitions="textStaticSettingDefs" :values="layer.textStaticSettings" @change="emit('staticSetting', $event)"/>
		<GsVisualParam
			v-for="[key, def] in Object.entries(textParamDefs)"
			:key="key"
			keyframesEnabled
			:automationGraphEndEnabled="false"
			:availableVariables="LAYER_VAR_DEFS"
			:automationGraphs="layer.automationGraphs"
			:projectAutomationGraphs="appContext.projectContext.stateManager.state.automationGraphs.value"
			:paramPath="[key]"
			:paramDef="def"
			:paramValue="values[key] ?? def.defaultValue"
			@edit="emit('edit', $event)"
		/>
	</div>
</GsFolder>
</template>

<script lang="ts" setup>
import { appContext } from '@/app.ts';
import { i18n } from '@/i18n.ts';
import { computed } from 'vue';
import { textParamDefs, textStaticSettingDefs } from '@gs/subsystems_timeline_shared/layers/text/text.ts';
import { LAYER_VAR_DEFS } from '@gs/subsystems_timeline_shared/expression.ts';
import GsFolder from './common/GsFolder.vue';
import GsVisualParam from './GsVisualParam.vue';
import GsStaticSettings from './GsStaticSettings.vue';
import type { ParamEdit } from './GsVisualParam.vue';
import type { TimelineTextLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineParameterBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';

const props = defineProps<{ layer: TimelineTextLayer }>();
const emit = defineEmits<{ staticSetting: [edit: { key: string; value: string | number | boolean | null }]; edit: [event: ParamEdit] }>();
const values = computed<Record<string, TimelineParameterBinding>>(() => props.layer.textParamValues);
</script>
