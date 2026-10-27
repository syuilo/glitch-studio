<template>
<GsFolder asSection defaultOpen :withSpacer="false" data-test-timeline-custom-parameters>
	<template #icon><i class="ti ti-adjustments-horizontal"></i></template>
	<template #label>{{ i18n.ts._Parameter.CustomParameter }}</template>
	<div class="_spacer _gaps_m">
		<GsFolder v-for="definition in layer.customParameterDefs ?? []" :key="definition.id" defaultOpen :data-test-timeline-custom-parameter="definition.id">
			<template #label>{{ definition.ui.label }}</template>
			<GsVisualParam
				keyframesEnabled
				:automationGraphEndEnabled="false"
				:availableVariables="LAYER_VAR_DEFS"
				:automationGraphs="layer.automationGraphs"
				:projectAutomationGraphs="stateManager.state.automationGraphs.value"
				:paramPath="[definition.id]"
				:paramDef="definition"
				:paramValue="layer.customParameterValues?.[definition.id] ?? definition.defaultValue"
				@edit="emit('edit', $event)"
			/>
			<GsFolder>
				<template #label>{{ i18n.ts._ParameterEditor.Definition }}</template>
				<XCustomParameterDefinitionEditor :def="definition" :supportedTypes="supportedTypes" @update="(changes, mergeKey) => update(definition, changes, mergeKey)" @remove="remove(definition)"/>
			</GsFolder>
		</GsFolder>
		<GsButton data-test-add-timeline-custom-parameter icon="ti ti-plus" @click="add">{{ i18n.ts._VisualModule.AddParameter }}</GsButton>
	</div>
</GsFolder>
</template>

<script lang="ts" setup>
import { computed, provide } from 'vue';
import { genId } from '@gs/shared/utility/id.ts';
import { getTimelineLayerCustomParameterContext, timelineLayerCustomParameterId } from '@gs/subsystems_timeline_shared/custom-parameters.ts';
import { LAYER_VAR_DEFS } from '@gs/subsystems_timeline_shared/expression.ts';
import GsVisualParam from './GsVisualParam.vue';
import XCustomParameterDefinitionEditor from './XCustomParameterDefinitionEditor.vue';
import GsFolder from './common/GsFolder.vue';
import GsButton from './common/GsButton.vue';
import type { TimelineLayerCustomParameterDefinition } from '@gs/subsystems_timeline_shared/custom-parameters.ts';
import type { CustomParameterDefinitionEdit } from '@/types/parameter-edit.ts';
import type { TimelineLayerWithParameters, TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { ParamEdit } from './GsVisualParam.vue';
import { timelineParameterEditorContextKey } from '@/utility/timeline-parameter-editor-context.ts';
import { appContext } from '@/app.ts';
import { i18n } from '@/i18n.ts';

const props = defineProps<{ scene: TimelineScene; layer: TimelineLayerWithParameters }>();
const emit = defineEmits<{ edit: [event: ParamEdit] }>();
const { stateManager } = appContext.projectContext;
const supportedTypes = ['scalar', 'bool', 'string', 'color', 'vector', 'enum', 'colorRamp'];
provide(timelineParameterEditorContextKey, { context: computed(() => getTimelineLayerCustomParameterContext(props.scene.layers, props.layer.id)), isCustomParameterValue: true });

function update(definition: TimelineLayerCustomParameterDefinition, changes: CustomParameterDefinitionEdit, mergeKey?: string | null) {
	stateManager.commit('updateTimelineLayerCustomParameter', {
		sceneId: props.scene.id,
		layerId: props.layer.id,
		definition: { ...definition, ...changes } as TimelineLayerCustomParameterDefinition,
	}, mergeKey == null ? null : JSON.stringify([props.layer.id, definition.id, mergeKey]));
}

function remove(definition: TimelineLayerCustomParameterDefinition) {
	stateManager.commit('removeTimelineLayerCustomParameter', { sceneId: props.scene.id, layerId: props.layer.id, parameterId: definition.id });
}

function add() {
	let nameForReference = 'my_param';
	for (let suffix = 2; props.layer.customParameterDefs?.some(definition => definition.nameForReference === nameForReference) === true; suffix++) nameForReference = `my_param_${suffix}`;
	stateManager.commit('updateTimelineLayerCustomParameter', {
		sceneId: props.scene.id,
		layerId: props.layer.id,
		definition: {
			id: timelineLayerCustomParameterId(genId()),
			nameForReference,
			dataType: { kind: 'scalar' },
			ui: { label: nameForReference, control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.5 },
			canNode: false,
		},
	});
}
</script>
