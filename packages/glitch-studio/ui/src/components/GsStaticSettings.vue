<template>
<div class="_gaps_s">
	<div v-for="[key, definition] in Object.entries(definitions)" :key="key" :data-test-static-setting="key">
		<div>{{ definition.ui.label }}</div>
		<div v-if="definition.dataType.kind === 'assetReference'" style="display: flex; gap: 4px;">
			<GsButton style="flex: 1;" @click="chooseAsset(key, definition)">{{ assetName(resolvedValues[key]) }}</GsButton>
			<GsButton v-if="resolvedValues[key] != null" iconOnly icon="ti ti-x" :title="i18n.ts.None" @click="emit('change', { key, value: null })"/>
		</div>
		<GsSelect v-else-if="definition.dataType.kind === 'playerReference'" :modelValue="settingReferenceValue(key)" :items="playerItems" @update:modelValue="value => emit('change', { key, value })"/>
		<GsSelect v-else-if="definition.dataType.kind === 'enum'" :modelValue="String(resolvedValues[key])" :items="definition.dataType.options.map(value => ({ value, label: value }))" @update:modelValue="value => emit('change', { key, value })"/>
		<GsSwitch v-else-if="definition.dataType.kind === 'bool'" :modelValue="resolvedValues[key] === true" @update:modelValue="value => emit('change', { key, value })"/>
		<GsInput v-else :type="definition.dataType.kind === 'scalar' ? 'number' : 'text'" :modelValue="settingInputValue(key)" @update:modelValue="value => { if (value != null) emit('change', { key, value }); }"/>
	</div>
</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue';
import { createStaticSettingValues } from '@gs/shared/static-setting.ts';
import { getAssetReferenceMimeType } from '@gs/shared/data-type/asset-reference.ts';
import GsButton from './common/GsButton.vue';
import GsSelect from './common/GsSelect.vue';
import GsInput from './common/GsInput.vue';
import GsSwitch from './common/GsSwitch.vue';
import type { StaticSettingDefinition, StaticSettingDefinitions, StaticSettingValues } from '@gs/shared/static-setting.ts';
import { appContext } from '@/app.ts';
import { selectAsset } from '@/ui.ts';
import { i18n } from '@/i18n.ts';

const props = defineProps<{ definitions: StaticSettingDefinitions; values: StaticSettingValues }>();
const emit = defineEmits<{ change: [edit: { key: string; value: string | number | boolean | null }] }>();
const state = appContext.projectContext.stateManager.state;
const playerItems = computed(() => [{ value: null, label: i18n.ts.None }, ...state.players.value.map(player => ({ value: player.id, label: player.name }))]);
const resolvedValues = computed(() => createStaticSettingValues(props.definitions, props.values));
const settingReferenceValue = (key: string) => {
	const value = resolvedValues.value[key];
	return typeof value === 'string' ? value : null;
};
const settingInputValue = (key: string) => {
	const value = resolvedValues.value[key];
	return typeof value === 'string' || typeof value === 'number' ? value : null;
};
const assetName = (id: string | number | boolean | null) => state.assets.value.find(asset => asset.id === id)?.name ?? (id == null ? i18n.ts._Assets.SelectButton : i18n.ts._Assets.Missing);
let disposed = false;
onBeforeUnmount(() => { disposed = true; });

async function chooseAsset(key: string, definition: StaticSettingDefinition) {
	if (definition.dataType.kind !== 'assetReference') return;
	const selectedSettings = props.values;
	const [asset] = await selectAsset({ multiple: false, mimeType: getAssetReferenceMimeType(definition.dataType) });
	if (disposed || asset == null || props.definitions[key] !== definition || props.values !== selectedSettings) return;
	emit('change', { key, value: asset.id });
}
</script>
