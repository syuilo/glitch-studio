<template>
<div :class="$style.root" data-test-project-automation-graphs>
	<div :class="$style.toolbar">
		<GsButton v-tooltip="i18n.ts._AutomationGraph.AddGraph" data-test-add-automation-graph icon="ti ti-plus" iconOnly @click="addGraph()"></GsButton>
		<GsButton data-test-select-automation-graph @click="selectGraph"><i class="ti ti-chevron-down"></i> {{ selectedGraph != null ? selectedGraph.nameForReference : '' }}</GsButton>
	</div>
	<template v-if="selectedGraph != null">
		<div :class="$style.header">
			<GsTabs v-model="tab" :def="tabs" data-test-visual-module-tabs/>
		</div>

		<div v-if="tab === 'graph'" :class="$style.editor">
			<GsAutomationGraphPointsEditor :key="selectedGraph.id + String(selectedGraph.isNormalized)" :points="selectedGraph.points" :isNormalized="selectedGraph.isNormalized" @change="updatePoints"/>
		</div>
		<div v-else-if="tab === 'settings'" class="_spacer _gaps_l">
			<GsInput :key="selectedGraph.id" data-test-automation-graph-reference-name monospace :manualSave="true" :modelValue="selectedGraph.nameForReference" @update:modelValue="setNameForReference">
				<template #label>{{ i18n.ts._ParameterEditor.ReferenceName }}</template>
			</GsInput>

			<GsSelect :modelValue="selectedGraph.isNormalized ? 'normalized' : 'milliseconds'" :items="timeAxisItems" @update:modelValue="setNormalized($event === 'normalized')">
				<template #label>{{ i18n.ts._Parameter.TimeAxis }}</template>
			</GsSelect>

			<GsButton icon="ti ti-copy" @click="addGraph(selectedGraph)">{{ i18n.ts.Duplicate }}</GsButton>

			<GsButton data-test-delete-automation-graph danger icon="ti ti-trash" @click="removeGraph">{{ i18n.ts.Delete }}</GsButton>
		</div>
	</template>
	<div v-else>
		<div>{{ i18n.ts._AutomationGraph.Empty }}</div>
		<GsButton data-test-add-automation-graph icon="ti ti-plus" @click="addGraph()">{{ i18n.ts._AutomationGraph.AddGraph }}</GsButton>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import GsAutomationGraphPointsEditor from './GsAutomationGraphPointsEditor.vue';
import GsTabs from './common/GsTabs.vue';
import type { AutomationGraph, BezierAnchorPoint } from '@gs/shared/automation-graph/automation-graph.ts';
import type { WorkspacePanel } from '@/workspace.ts';
import { appContext } from '@/app.ts';
import { i18n } from '@/i18n.ts';
import * as ui from '@/ui.ts';
import { createProjectAutomationGraph, setInlineAutomationGraphNormalized } from '@/utility/automation-graph.ts';

defineProps<{ panel: WorkspacePanel }>();

const tab = ref('graph');
const tabs = [
	{ id: 'graph', label: i18n.ts._AutomationGraph.Graph },
	{ id: 'settings', label: i18n.ts.Settings },
];

const { stateManager } = appContext.projectContext;
const graphs = stateManager.state.automationGraphs;
const selectedGraphId = ref<string | null>(null);
const selectedGraph = computed(() => graphs.value.find(graph => graph.id === selectedGraphId.value) ?? graphs.value[0] ?? null);
const timeAxisItems = [
	{ label: i18n.ts._Parameter.NormalizedTime, value: 'normalized' },
	{ label: i18n.ts._Parameter.Milliseconds, value: 'milliseconds' },
];

function selectGraph(ev: PointerEvent) {
	ui.popupMenu(graphs.value.map(graph => ({
		text: graph.nameForReference,
		active: selectedGraph.value?.id === graph.id,
		action: () => { selectedGraphId.value = graph.id; },
	})), ev.currentTarget ?? ev.target);
}

function setNameForReference(nameForReference: string) {
	const graph = selectedGraph.value;
	if (graph == null || graph.nameForReference === nameForReference) return;
	try {
		stateManager.commit('updateProjectAutomationGraph', { automationGraph: { ...graph, nameForReference } });
	} catch (error) {
		ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
	}
}

function addGraph(source?: AutomationGraph) {
	const automationGraph = createProjectAutomationGraph(graphs.value, source);
	stateManager.commit('addProjectAutomationGraph', { automationGraph });
	selectedGraphId.value = automationGraph.id;
}

function removeGraph() {
	if (selectedGraph.value != null) stateManager.commit('removeProjectAutomationGraph', { automationGraphId: selectedGraph.value.id });
}

function updatePoints(points: BezierAnchorPoint[], mergeKey: string | null) {
	if (selectedGraph.value != null) stateManager.commit('updateProjectAutomationGraph', { automationGraph: { ...selectedGraph.value, points } }, mergeKey);
}

function setNormalized(isNormalized: boolean) {
	const graph = selectedGraph.value;
	if (graph == null || graph.isNormalized === isNormalized) return;
	const converted = setInlineAutomationGraphNormalized({ inputSource: 'automationGraphInline', automationGraph: graph, trimmedDurationMs: 1000, wrapMode: 'clamp', offsetMode: 'start' }, isNormalized);
	stateManager.commit('updateProjectAutomationGraph', { automationGraph: { ...graph, ...converted.automationGraph } });
}
</script>

<style module lang="scss">
.root {
	height: 100%;
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 12px;
	overflow: auto;
}
.toolbar {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}
.editor {
	flex: 1;
	min-height: 280px;
}
</style>
