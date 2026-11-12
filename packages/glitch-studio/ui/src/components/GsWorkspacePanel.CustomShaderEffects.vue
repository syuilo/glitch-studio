<template>
<div :class="$style.root" data-test-custom-shader-effects>
	<div :class="$style.toolbar">
		<GsButton v-tooltip="i18n.ts._CustomShaderEffect.Add" data-test-add-custom-shader-effect icon="ti ti-plus" @click="add()">{{ i18n.ts.Add }}</GsButton>
		<GsSelect v-if="definitions.length > 0" :modelValue="selected?.id ?? null" :items="definitionItems" data-test-select-custom-shader-effect @update:modelValue="selectedId = $event"/>
		<GsButton v-if="selected != null" data-test-duplicate-custom-shader-effect icon="ti ti-copy" @click="add(selected)">{{ i18n.ts.Duplicate }}</GsButton>
		<GsButton v-if="selected != null" :disabled="isCustomShaderEffectUsed(stateManager.state, selected.id)" :title="i18n.ts._CustomShaderEffect.InUse" data-test-delete-custom-shader-effect danger icon="ti ti-trash" @click="remove">{{ i18n.ts.Delete }}</GsButton>
	</div>
	<GsCustomShaderEffectEditor v-if="selected != null" :key="selected.id" :customShaderEffect="selected" @apply="apply"/>
</div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import GsButton from './common/GsButton.vue';
import GsSelect from './common/GsSelect.vue';
import GsCustomShaderEffectEditor from './GsCustomShaderEffectEditor.vue';
import type { WorkspacePanel } from '@/workspace.ts';
import type { ProjectCustomShaderEffect } from '@gs/glitch-studio_shared/project/types.ts';
import { useProjectSession } from '@/project-session.ts';
import { i18n } from '@/i18n.ts';
import { isCustomShaderEffectUsed } from '@/utility/custom-shader-effect-usages.ts';
import { createProjectCustomShaderEffect } from '@/utility/custom-shader-effect.ts';

defineProps<{ panel: WorkspacePanel }>();

const projectSession = useProjectSession();

const { projectContext } = projectSession;
const { stateManager } = projectContext;
const definitions = stateManager.state.customShaderEffects;
const selectedId = ref<string | null>(null);
const selected = computed(() => definitions.value.find(definition => definition.id === selectedId.value) ?? definitions.value[0] ?? null);
const definitionItems = computed(() => definitions.value.map(definition => ({ value: definition.id, label: definition.name })));

function add(source: ProjectCustomShaderEffect | null = null) {
	const customShaderEffect = createProjectCustomShaderEffect(definitions.value, source);
	stateManager.commit('addCustomShaderEffect', { customShaderEffect });
	selectedId.value = customShaderEffect.id;
}

function apply(customShaderEffect: ProjectCustomShaderEffect) {
	stateManager.commit('updateCustomShaderEffect', { customShaderEffect });
}

function remove() {
	if (selected.value != null) stateManager.commit('removeCustomShaderEffect', { customShaderEffectId: selected.value.id });
}
</script>

<style module lang="scss">
.root {
	height: 100%;
	overflow: auto;
}

.toolbar {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 8px;
	padding: 8px;
}
</style>
