<template>
<div :class="$style.root" data-test-custom-shader-effects>
	<div :class="$style.toolbar">
		<GsButton v-tooltip="i18n.ts._CustomShaderEffect.Add" data-test-add-custom-shader-effect icon="ti ti-plus" @click="add()">{{ i18n.ts.Add }}</GsButton>
		<GsSelect v-if="definitions.length > 0" :modelValue="selected?.id ?? null" :items="definitionItems" data-test-select-custom-shader-effect @update:modelValue="selectedId = $event"/>
		<GsButton v-if="selected != null" data-test-duplicate-custom-shader-effect icon="ti ti-copy" @click="add(selected)">{{ i18n.ts.Duplicate }}</GsButton>
		<GsButton v-if="selected != null" v-tooltip="i18n.ts._CustomShaderEffect.InUse" :disabled="isCustomShaderEffectUsed(stateManager.state, selected.id)" data-test-delete-custom-shader-effect danger icon="ti ti-trash" @click="remove">{{ i18n.ts.Delete }}</GsButton>
		<template v-if="selected != null">
			<GsButton
				v-tooltip="i18n.ts._CustomShaderEffect.PreviewApplied"
				:primary="previewActive"
				data-test-preview-custom-shader-effect
				icon="ti ti-player-play"
				@click="projectSession.startCustomShaderEffectLivePreview(selected.id)"
			>{{ i18n.ts.Preview }}</GsButton>
			<span v-if="previewActive && projectSession.effectLivePreviewManagerController.preparationStatus.value?.type === 'loading'">{{ i18n.ts.Loading }}</span>
		</template>
	</div>

	<GsCustomShaderEffectEditor v-if="selected != null" :key="selected.id" :customShaderEffect="selected" @apply="apply">
		<template #preview>
			<div :class="$style.previewParams">
				<GsEffectLivePreviewResolution
					:effectSource="{ type: 'customShaderEffectReference', id: selected.id }"
					@activate="projectSession.startCustomShaderEffectLivePreview(selected.id)"
				/>
				<GsEffectLivePreviewInput
					:effectSource="{ type: 'customShaderEffectReference', id: selected.id }"
					@activate="projectSession.startCustomShaderEffectLivePreview(selected.id)"
				/>
				<template v-for="{ id, definition } in previewParamDefs" :key="id">
					<GsVisualParam
						previewMediaInputEnabled
						:availableVariables="EFFECT_LIVE_PREVIEW_VAR_DEFS"
						:paramPath="[id]"
						:automationGraphs="[]"
						:projectAutomationGraphs="stateManager.state.automationGraphs.value"
						:paramDef="definition"
						:paramValue="previewParamValues[id] ?? previewDefaultBindings[id]"
						:defaultBinding="previewDefaultBindings[id]"
						:data-test-custom-shader-effect-preview-parameter="id"
						@edit="onPreviewParamEdit"
					/>
				</template>
			</div>
		</template>
	</GsCustomShaderEffectEditor>
</div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, provide, ref } from 'vue';
import { EFFECT_LIVE_PREVIEW_VAR_DEFS } from '@gs/glitch-studio_shared/effect-live-preview-expression.ts';
import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import GsButton from './common/GsButton.vue';
import GsSelect from './common/GsSelect.vue';
import GsCustomShaderEffectEditor from './GsCustomShaderEffectEditor.vue';
import GsEffectLivePreviewInput from './GsEffectLivePreviewInput.vue';
import GsEffectLivePreviewResolution from './GsEffectLivePreviewResolution.vue';
import GsVisualParam from './GsVisualParam.vue';
import type { WorkspacePanel } from '@/workspace.ts';
import type { ProjectCustomShaderEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { EffectLivePreviewParameterBinding } from '@gs/glitch-studio_shared/effect-live-preview-input.ts';
import type { ParamEdit } from './GsVisualParam.vue';
import { useProjectSession } from '@/project-session.ts';
import { i18n } from '@/i18n.ts';
import { isCustomShaderEffectUsed } from '@/utility/custom-shader-effect-usages.ts';
import { editEffectLivePreviewParameter } from '@/utility/effect-live-preview-parameter.ts';
import { handlePreviewParameterClipboard } from '@/utility/parameter-clipboard-actions.ts';
import { previewParameterContextKey } from '@/utility/preview-parameter-editing.ts';
import * as ui from '@/ui.ts';

defineProps<{ panel: WorkspacePanel }>();

const projectSession = useProjectSession();

const { projectContext } = projectSession;
const { stateManager } = projectContext;
const definitions = stateManager.state.customShaderEffects;
const selectedId = ref<string | null>(null);
const selected = computed(() => definitions.value.find(definition => definition.id === selectedId.value) ?? definitions.value[0] ?? null);
const definitionItems = computed(() => definitions.value.map(definition => ({ value: definition.id, label: definition.name })));

const previewActive = computed(() => selected.value != null && projectSession.previewPlayback.livePreviewCustomShaderEffectId.value === selected.value.id);
const previewParamDefs = computed(() => Object.entries(selected.value?.definition.paramDefs ?? {}).map(([id, definition]) => ({
	id, definition,
})));
const previewDefaultBindings = computed(() => Object.fromEntries(previewParamDefs.value.map(({ id, definition }) =>
	[id, createDefaultParameterBinding(definition)])));
const previewParamValues = computed(() => selected.value == null ? {} : projectSession.getCustomShaderEffectPreviewParamValues(selected.value.id));
let disposed = false;
onBeforeUnmount(() => { disposed = true; });

provide(previewParameterContextKey, {
	scope: computed(() => selected.value == null ? null : {
		kind: 'livePreview', effectSource: { type: 'customShaderEffectReference', id: selected.value.id },
	} as const),
	label: computed(() => selected.value?.name ?? ''),
	beginLivePreviewEdit(path) {
		const customShaderEffect = selected.value;
		const id = path[0] as string;
		const before = previewParamValues.value[id] ?? null;
		let active = true;
		const isActive = () => active && !disposed && previewActive.value && selected.value === customShaderEffect;
		return {
			get active() { return isActive(); },
			update(edit) { if (isActive()) onPreviewParamEdit({ ...edit, paramPath: path }); },
			finish() { active = false; },
			cancel() {
				if (customShaderEffect != null && isActive()) setPreviewParameterValue(customShaderEffect.id, id, before);
				active = false;
			},
		};
	},
});

function setPreviewParameterValue(customShaderEffectId: string, id: string, binding: EffectLivePreviewParameterBinding | null) {
	const values = { ...projectSession.getCustomShaderEffectPreviewParamValues(customShaderEffectId) };
	if (binding == null) delete values[id];
	else values[id] = binding;
	projectSession.updateCustomShaderEffectLivePreviewParamValues(customShaderEffectId, values);
}

function onPreviewParamEdit(event: ParamEdit) {
	const customShaderEffect = selected.value;
	if (customShaderEffect == null) return;
	const id = event.paramPath[0] as string;
	const definition = customShaderEffect.definition.paramDefs[id];
	if (definition == null) return;
	if (event.kind === 'copy' || event.kind === 'paste') {
		void handlePreviewParameterClipboard(projectContext, projectSession.id, { type: 'customShaderEffectReference', id: customShaderEffect.id }, event.paramPath, event.kind,
			id => ({ binding: previewParamValues.value[id] ?? null, followsDefault: previewParamValues.value[id] == null }),
			() => !disposed && selected.value === customShaderEffect,
			(id, binding) => setPreviewParameterValue(customShaderEffect.id, id, binding),
		).catch(error => ui.alert({ type: 'error', text: String(error) }));
		return;
	}
	if (event.kind === 'reset') {
		setPreviewParameterValue(customShaderEffect.id, id, null);
		return;
	}
	const next = editEffectLivePreviewParameter(definition, previewParamValues.value[id] ?? previewDefaultBindings.value[id], event);
	if (next != null) setPreviewParameterValue(customShaderEffect.id, id, next);
}

function add(source: ProjectCustomShaderEffect | null = null) {
	const result = source == null ? stateManager.commit('createCustomShaderEffect', {})
		: stateManager.commit('duplicateCustomShaderEffect', { customShaderEffectId: source.id });
	selectedId.value = result.customShaderEffectId;
}

function apply(customShaderEffect: ProjectCustomShaderEffect) {
	stateManager.commit('replaceCustomShaderEffectDefinition', { customShaderEffectId: customShaderEffect.id, definition: customShaderEffect });
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

.previewParams {
	padding: 8px;
	border-bottom: 1px solid var(--THEME-divider);
}
</style>
