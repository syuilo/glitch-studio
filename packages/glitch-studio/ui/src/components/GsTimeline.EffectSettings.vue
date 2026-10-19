<template>
<GsFolder :asSection="true" defaultOpen :withSpacer="false">
	<template #icon><i class="ti ti-sparkles"></i></template>
	<template #label>{{ i18n.ts._TimelineLayer.Effect }}: {{ definition.displayName }}</template>
	<template #suffix>
		<span v-if="effectState?.status.type === 'loading'"><i class="ti ti-loader-2"></i> {{ i18n.ts.Loading }}<GsEllipsis/></span>
		<span v-else-if="effectState?.status.type === 'error'" :class="$style.error" :title="effectState.status.message"><i class="ti ti-alert-triangle"></i> {{ i18n.ts.Error }}</span>
		<span v-else-if="outputResolution">{{ outputResolution.width }} × {{ outputResolution.height }}</span>
	</template>
	<div v-if="effectState?.status.type === 'error'" class="_spacer">
		<div :class="$style.errorMessage">{{ effectState.status.message }}</div>
	</div>
	<div style="padding: 8px 0;">
		<GsVisualParam
			v-for="[key, def] in Object.entries(definition.paramDefs)"
			:key="key"
			keyframesEnabled
			imageInputEnabled
			imageInputSamplingEnabled
			:imageLayerOptions="imageLayerOptions"
			:anotherLayerAudioOptions="anotherLayerAudioOptions"
			:automationGraphEndEnabled="false"
			:availableVariables="LAYER_VAR_DEFS"
			:automationGraphs="layer.automationGraphs"
			:paramPath="[key]"
			:paramDef="def"
			:paramValue="layer.effectParamValues[key] ?? getEffectLayerParameterDefault(definition, key)"
			@edit="emit('edit', $event)"
		/>
	</div>
	<div class="_spacer">
		<GsSelect large :modelValue="layer.resolution.mode" :items="resolutionModes" @update:modelValue="setResolutionMode">
			<template #label>{{ i18n.ts.Resolution }}</template>
			<template v-if="layer.resolution.mode === 'context'" #caption>{{ i18n.ts._TimelineLayer.ResolutionHint }}</template>
		</GsSelect>
		<div v-if="layer.resolution.mode === 'customAbsolute'" style="display: flex; gap: 8px;">
			<GsInput large style="flex: 1;" type="number" :modelValue="layer.resolution.width" :min="1" :step="1" :debounce="400" @update:modelValue="setDimension('width', $event)"><template #label>{{ i18n.ts.Width }}</template><template #suffix>px</template></GsInput>
			<GsInput large style="flex: 1;" type="number" :modelValue="layer.resolution.height" :min="1" :step="1" :debounce="400" @update:modelValue="setDimension('height', $event)"><template #label>{{ i18n.ts.Height }}</template><template #suffix>px</template></GsInput>
		</div>
	</div>
</GsFolder>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import { LAYER_VAR_DEFS } from '@gs/subsystems_timeline_shared/expression.ts';
import { getEffectLayerParameterDefault } from '@gs/subsystems_timeline_shared/layers/effect/effect-layer.ts';
import GsFolder from './common/GsFolder.vue';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import GsVisualParam from './GsVisualParam.vue';
import GsEllipsis from './common/GsEllipsis.vue';
import type { AnotherLayerAudioOption, ParamEdit } from './GsVisualParam.vue';
import type { TimelineEffectLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { EffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { EffectInstanceState } from '@gs/subsystems_effect_shared/effect-status.ts';
import { i18n } from '@/i18n.ts';

const props = defineProps<{ layer: TimelineEffectLayer; contextResolution: Resolution; effectState?: EffectInstanceState | null; imageLayerOptions: readonly { value: string; label: string }[]; anotherLayerAudioOptions: readonly AnotherLayerAudioOption[] }>();
const emit = defineEmits<{ edit: [event: ParamEdit]; resolution: [resolution: EffectResolution] }>();
const definition = computed(() => effectDefinitions[props.layer.effectId]);
const outputResolution = computed(() => definition.value.primaryOutput == null ? null : props.effectState?.outputs[definition.value.primaryOutput]);
const resolutionModes: { value: EffectResolution['mode']; label: string }[] = [
	{ value: 'auto', label: i18n.ts.Auto }, { value: 'context', label: i18n.ts._Node.ContextResolution }, { value: 'customAbsolute', label: i18n.ts._Node.CustomResolution },
];

function setResolutionMode(mode: EffectResolution['mode']) {
	if (mode !== props.layer.resolution.mode) emit('resolution', mode === 'customAbsolute' ? { mode, ...props.contextResolution } : { mode });
}

function setDimension(axis: 'width' | 'height', value: number | null) {
	if (props.layer.resolution.mode !== 'customAbsolute' || value == null || !Number.isSafeInteger(value) || value < 1) return;
	emit('resolution', { ...props.layer.resolution, [axis]: value });
}
</script>

<style module>
.error, .errorMessage {
	color: var(--THEME-error);
}
.errorMessage {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
</style>
