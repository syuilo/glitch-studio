<template>
<div class="_gaps_m">
	<GsSelect
		v-model="mode" large :items="modeItems" :disabled="disabled"
		data-test-effect-render-tiling-mode
	>
		<template #label>{{ i18n.ts._Settings.EffectRenderTiling }}</template>
		<template #caption>{{ i18n.ts._Settings.EffectRenderTilingHint }}</template>
	</GsSelect>
	<GsInput
		v-if="mode === 'manual'"
		v-model="tileSize" large type="number" manualSave
		:min="1" :max="32768" :step="1" :disabled="disabled"
		data-test-effect-render-tile-size
	>
		<template #label>{{ i18n.ts._Settings.EffectRenderTileSize }}</template>
		<template #suffix>px</template>
		<template #caption>{{ i18n.ts._Settings.EffectRenderTileSizeHint }}</template>
	</GsInput>
</div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import GsSelect from './common/GsSelect.vue';
import GsInput from './common/GsInput.vue';
import { i18n } from '@/i18n.ts';
import type { EffectRenderTiling } from '@gs/subsystems_effect_shared/effect-render-tiling.ts';

defineProps<{ disabled?: boolean }>();
const model = defineModel<EffectRenderTiling>({ required: true });
const manualTileSize = ref(model.value.mode === 'manual' ? model.value.tileSize : 512);
const modeItems: { value: EffectRenderTiling['mode']; label: string }[] = [
	{ value: 'auto', label: i18n.ts._Settings.EffectRenderTilesAutomatic },
	{ value: 'disabled', label: i18n.ts._Settings.EffectRenderTilesDisabled },
	{ value: 'manual', label: i18n.ts._Settings.EffectRenderTilesManual },
];
const mode = computed({
	get: () => model.value.mode,
	set: (value: EffectRenderTiling['mode']) => {
		if (model.value.mode === 'manual') manualTileSize.value = model.value.tileSize;
		model.value = value === 'manual' ? { mode: value, tileSize: manualTileSize.value } : { mode: value };
	},
});
const tileSize = computed({
	get: () => model.value.mode === 'manual' ? model.value.tileSize : manualTileSize.value,
	set: (value: number) => {
		if (!Number.isFinite(value)) return;
		manualTileSize.value = Math.max(1, Math.min(32768, Math.round(value)));
		model.value = { mode: 'manual', tileSize: manualTileSize.value };
	},
});
</script>
