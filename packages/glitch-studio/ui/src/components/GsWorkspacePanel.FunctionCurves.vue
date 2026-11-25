<template>
<div :class="$style.root" data-test-project-function-curves>
	<div :class="$style.toolbar">
		<GsButton v-tooltip="i18n.ts._FunctionCurve.AddFunctionCurve" data-test-add-function-curve icon="ti ti-plus" iconOnly @click="addFunctionCurve()"></GsButton>
		<GsButton data-test-select-function-curve @click="selectFunctionCurve"><i class="ti ti-chevron-down"></i> {{ selectedFunctionCurve != null ? selectedFunctionCurve.nameForReference : '' }}</GsButton>
	</div>
	<template v-if="selectedFunctionCurve != null">
		<div :class="$style.header">
			<GsTabs v-model="tab" :def="tabs" data-test-function-curve-tabs/>
		</div>

		<div v-if="tab === 'functionCurve'" :class="$style.editor">
			<GsFunctionCurvePointsEditor
				:key="selectedFunctionCurve.id + String(selectedFunctionCurve.isXNormalized) + String(selectedFunctionCurve.isYNormalized)"
				:points="selectedFunctionCurve.points"
				:isXNormalized="selectedFunctionCurve.isXNormalized"
				:isYNormalized="selectedFunctionCurve.isYNormalized"
				@change="updatePoints"
			/>
		</div>
		<div v-else-if="tab === 'settings'" class="_spacer _gaps_l">
			<GsInput :key="selectedFunctionCurve.id" data-test-function-curve-reference-name monospace :manualSave="true" :modelValue="selectedFunctionCurve.nameForReference" @update:modelValue="setNameForReference">
				<template #label>{{ i18n.ts._ParameterEditor.ReferenceName }}</template>
			</GsInput>

			<GsSelect
				:modelValue="selectedFunctionCurve.isXNormalized ? 'normalized' : 'milliseconds'"
				:items="timeAxisItems"
				@update:modelValue="value => setXNormalized(value === 'normalized')"
			>
				<template #label>{{ i18n.ts._FunctionCurve.XAxis }}</template>
			</GsSelect>
			<GsSelect
				:modelValue="selectedFunctionCurve.isYNormalized ? 'normalized' : 'raw'"
				:items="valueAxisItems"
				@update:modelValue="value => setYNormalized(value === 'normalized')"
			>
				<template #label>{{ i18n.ts._FunctionCurve.YAxis }}</template>
			</GsSelect>

			<GsButton icon="ti ti-copy" @click="addFunctionCurve(selectedFunctionCurve)">{{ i18n.ts.Duplicate }}</GsButton>

			<GsButton data-test-delete-function-curve danger icon="ti ti-trash" @click="removeFunctionCurve">{{ i18n.ts.Delete }}</GsButton>
		</div>
	</template>
	<div v-else>
		<div>{{ i18n.ts._FunctionCurve.Empty }}</div>
		<GsButton data-test-add-function-curve icon="ti ti-plus" @click="addFunctionCurve()">{{ i18n.ts._FunctionCurve.AddFunctionCurve }}</GsButton>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import GsFunctionCurvePointsEditor from './GsFunctionCurvePointsEditor.vue';
import GsTabs from './common/GsTabs.vue';
import type { SharedFunctionCurve, BezierAnchorPoint } from '@gs/shared/function-curve/function-curve.ts';
import type { WorkspacePanel } from '@/workspace.ts';
import { useProjectSession } from '@/project-session.ts';
import { i18n } from '@/i18n.ts';
import * as ui from '@/ui.ts';
import { setFunctionCurveXNormalized } from '@/utility/curve-animation.ts';

defineProps<{ panel: WorkspacePanel }>();

const projectSession = useProjectSession();

const tab = ref('functionCurve');
const tabs = [
	{ id: 'functionCurve', label: i18n.ts._FunctionCurve.FunctionCurve },
	{ id: 'settings', label: i18n.ts.Settings },
];

const { stateManager } = projectSession.projectContext;
const functionCurves = stateManager.state.functionCurves;
const selectedFunctionCurveId = ref<string | null>(null);
const selectedFunctionCurve = computed(() => functionCurves.value.find(functionCurve => functionCurve.id === selectedFunctionCurveId.value) ?? functionCurves.value[0] ?? null);
const timeAxisItems = [
	{ label: i18n.ts._FunctionCurve.Normalized, value: 'normalized' },
	{ label: i18n.ts._Parameter.Milliseconds, value: 'milliseconds' },
];
const valueAxisItems = [
	{ label: i18n.ts._FunctionCurve.Normalized, value: 'normalized' },
	{ label: i18n.ts._FunctionCurve.Raw, value: 'raw' },
];

function selectFunctionCurve(ev: PointerEvent) {
	ui.popupMenu(functionCurves.value.map(functionCurve => ({
		text: functionCurve.nameForReference,
		active: selectedFunctionCurve.value?.id === functionCurve.id,
		action: () => { selectedFunctionCurveId.value = functionCurve.id; },
	})), ev.currentTarget ?? ev.target);
}

function setNameForReference(nameForReference: string) {
	const functionCurve = selectedFunctionCurve.value;
	if (functionCurve == null || functionCurve.nameForReference === nameForReference) return;
	try {
		stateManager.commit('replaceProjectFunctionCurve', { functionCurveId: functionCurve.id, definition: { ...functionCurve, nameForReference } });
	} catch (error) {
		ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
	}
}

function addFunctionCurve(source?: SharedFunctionCurve) {
	const result = source == null ? stateManager.commit('createProjectFunctionCurve', {})
		: stateManager.commit('duplicateProjectFunctionCurve', { functionCurveId: source.id });
	selectedFunctionCurveId.value = result.functionCurveId;
}

function removeFunctionCurve() {
	if (selectedFunctionCurve.value != null) stateManager.commit('removeProjectFunctionCurve', { functionCurveId: selectedFunctionCurve.value.id });
}

function updatePoints(points: BezierAnchorPoint[], mergeKey: string | null) {
	if (selectedFunctionCurve.value != null) stateManager.commit('replaceProjectFunctionCurve', { functionCurveId: selectedFunctionCurve.value.id, definition: { ...selectedFunctionCurve.value, points } }, mergeKey);
}

function setXNormalized(isXNormalized: boolean) {
	const functionCurve = selectedFunctionCurve.value;
	if (functionCurve == null || functionCurve.isXNormalized === isXNormalized) return;
	const converted = setFunctionCurveXNormalized(functionCurve, isXNormalized, null);
	stateManager.commit('replaceProjectFunctionCurve', { functionCurveId: functionCurve.id, definition: { ...functionCurve, ...converted.functionCurve } });
}

function setYNormalized(isYNormalized: boolean) {
	const functionCurve = selectedFunctionCurve.value;
	if (functionCurve == null || functionCurve.isYNormalized === isYNormalized) return;
	// 共有定義の座標を維持する。出力範囲は利用側の各Curve Animationが所有する。
	stateManager.commit('replaceProjectFunctionCurve', { functionCurveId: functionCurve.id, definition: { ...functionCurve, isYNormalized } });
}
</script>

<style module lang="scss">
.root {
	height: 100%;
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	overflow: auto;
}
.toolbar {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	padding: 4px 8px 0 8px;
}
.editor {
	flex: 1;
}
</style>
