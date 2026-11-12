<template>
<GsFolder asSection defaultOpen :withSpacer="false" data-test-timeline-public-parameters>
	<template #icon><i class="ti ti-adjustments-horizontal"></i></template>
	<template #label>{{ i18n.ts._Parameter.PublicParameter }}</template>
	<div class="_spacer _gaps_m">
		<GsFolder v-for="definition in layer.publicParameterDefs ?? []" :key="definition.id" defaultOpen :data-test-timeline-public-parameter="definition.id">
			<template #label>{{ definition.ui.label }}</template>
			<GsVisualParam
				previewParameterGroup="publicParameter"
				keyframesEnabled
				:automationGraphEndEnabled="false"
				:availableVariables="LAYER_VAR_DEFS"
				:automationGraphs="layer.automationGraphs"
				:projectAutomationGraphs="stateManager.state.automationGraphs.value"
				:paramPath="[definition.id]"
				:paramDef="definition"
				:paramValue="layer.publicParameterValues?.[definition.id] ?? definition.defaultValue"
				@edit="emit('edit', $event)"
			/>
			<GsFolder>
				<template #label>{{ i18n.ts._ParameterEditor.Definition }}</template>
				<XPublicParameterDefinitionEditor :def="definition" :supportedTypes="supportedTypes" @update="(changes, mergeKey) => update(definition, changes, mergeKey)" @remove="remove(definition)"/>
			</GsFolder>
		</GsFolder>
		<GsButton data-test-add-timeline-public-parameter icon="ti ti-plus" @click="add">{{ i18n.ts._VisualModule.AddParameter }}</GsButton>
	</div>
</GsFolder>
</template>

<script lang="ts" setup>
import { computed, provide } from 'vue';
import { genId } from '@gs/shared/utility/id.ts';
import { getTimelineLayerPublicParameterContext, timelineLayerPublicParameterId } from '@gs/subsystems_timeline_shared/public-parameters.ts';
import { LAYER_VAR_DEFS } from '@gs/subsystems_timeline_shared/expression.ts';
import GsVisualParam from './GsVisualParam.vue';
import XPublicParameterDefinitionEditor from './XPublicParameterDefinitionEditor.vue';
import GsFolder from './common/GsFolder.vue';
import GsButton from './common/GsButton.vue';
import type { TimelineLayerPublicParameterDefinition } from '@gs/subsystems_timeline_shared/public-parameters.ts';
import type { PublicParameterDefinitionEdit } from '@/types/parameter-edit.ts';
import type { TimelineLayerWithParameters, TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { ParamEdit } from './GsVisualParam.vue';
import { timelineParameterEditorContextKey } from '@/utility/timeline-parameter-editor-context.ts';
import { useProjectSession } from '@/project-session.ts';
import { i18n } from '@/i18n.ts';

const projectSession = useProjectSession();

const props = defineProps<{ scene: TimelineScene; layer: TimelineLayerWithParameters }>();
const emit = defineEmits<{ edit: [event: ParamEdit] }>();
const { stateManager } = projectSession.projectContext;
const supportedTypes = ['scalar', 'bool', 'string', 'color', 'vector', 'enum', 'colorRamp', 'sizeReference'];
provide(timelineParameterEditorContextKey, { context: computed(() => getTimelineLayerPublicParameterContext(props.scene.layers, props.layer.id)), isPublicParameterValue: true });

function update(definition: TimelineLayerPublicParameterDefinition, changes: PublicParameterDefinitionEdit, mergeKey?: string | null) {
	stateManager.commit('updateTimelineLayerPublicParameter', {
		sceneId: props.scene.id,
		layerId: props.layer.id,
		definition: { ...definition, ...changes } as TimelineLayerPublicParameterDefinition,
	}, mergeKey == null ? null : JSON.stringify([props.layer.id, definition.id, mergeKey]));
}

function remove(definition: TimelineLayerPublicParameterDefinition) {
	stateManager.commit('removeTimelineLayerPublicParameter', { sceneId: props.scene.id, layerId: props.layer.id, parameterId: definition.id });
}

function add() {
	let nameForReference = 'my_param';
	for (let suffix = 2; props.layer.publicParameterDefs?.some(definition => definition.nameForReference === nameForReference) === true; suffix++) nameForReference = `my_param_${suffix}`;
	stateManager.commit('updateTimelineLayerPublicParameter', {
		sceneId: props.scene.id,
		layerId: props.layer.id,
		definition: {
			id: timelineLayerPublicParameterId(genId()),
			nameForReference,
			dataType: { kind: 'scalar' },
			ui: { label: nameForReference, control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.5 },
			canNode: false,
		},
	});
}
</script>
