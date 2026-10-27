<template>
<div :class="$style.root">
	<div ref="rowEl" :class="$style.row" data-wire-input-row @contextmenu.prevent.stop="onRowContextmenu">
		<div :class="[$style.paramHeader, { [$style.isDyamic]: paramValue.inputSource !== 'literal' }]">
			<button v-if="paramDef.dataType.kind === 'array' || paramDef.dataType.kind === 'struct'" class="_button"><i class="ti ti-chevron-down" style="vertical-align: middle;"></i></button>
			<GsNodePort v-else-if="canNode && node != null" :dataType="inputDataType" style="cursor: pointer;" @pointerdown.stop @click.stop="showNodeInputMenu" @update:element="portEl = $event"/>
			<GsNodePort v-else placeholder :data-type="null"/>

			<div :class="$style.paramLabel" data-test-parameter-menu @click="showMenu">
				<GsCondensedLine>{{ label ?? paramDef.ui.label }}</GsCondensedLine>
			</div>
			<div style="height: 100%; place-content: center;">
				<i v-if="paramValue.inputSource === 'envVariable'" v-tooltip="i18n.ts._Parameter.EnvironmentVariable" class="ti ti-variable" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'expression'" v-tooltip="i18n.ts._Parameter.Expression" class="ti ti-math-function" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'visualModuleCustomParameterReference'" v-tooltip="i18n.ts._Parameter.Title" class="ti ti-wifi" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'node'" v-tooltip="i18n.ts._Parameter.Node" class="ti ti-plug" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'anotherLayerOutput'" v-tooltip="i18n.ts._Parameter.AnotherLayerOutput" class="ti ti-stack" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'lowerLayerOutput'" v-tooltip="i18n.ts._Parameter.LowerLayerOutput" class="ti ti-stack-2" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'lowerLayerAudio'" v-tooltip="i18n.ts._Parameter.LowerLayerAudio" class="ti ti-wave-sine" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'anotherLayerAudio'" v-tooltip="i18n.ts._Parameter.AnotherLayerAudio" class="ti ti-wave-sine" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'keyframesTimelineInline'" v-tooltip="i18n.ts._Parameter.Keyframes" class="ti ti-timeline" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'automationGraphReference' || paramValue.inputSource === 'automationGraphInline'" v-tooltip="i18n.ts._Parameter.AutomationGraph" class="ti ti-ease-in-out-control-points" :class="$style.typeIcon"></i>
			</div>
		</div>
		<div :class="$style.paramBody">
			<template v-if="paramDef.dataType.kind === 'array'">
				<span :class="$style.count">{{ arrayValues.length }}</span>
				<GsButton v-tooltip="i18n.ts._Parameter.AddElement" iconOnly icon="ti ti-plus" @click="addElement"/>
			</template>
			<template v-else-if="paramDef.dataType.kind !== 'struct'">
				<i v-if="hasNodeInputTypeMismatch(nodes, nodeConnection, inputDataType, paramDefs) || ((paramValue.inputSource === 'lowerLayerOutput' || paramValue.inputSource === 'anotherLayerOutput') && !imageInputTypeCompatible)" v-tooltip="i18n.ts._Node.TypeMismatch" class="ti ti-alert-triangle" :class="$style.typeWarning"></i>
				<div :class="$style.control">
					<GsTextarea v-if="paramValue.inputSource === 'expression'" :key="paramPathKey(paramPath)" adaptiveHeight data-test-base-expression-code manualSave class="_monospace" :modelValue="paramValue.expression" @update:modelValue="updateParamAsExpression">
						<template #caption="{ value }">
							<div v-if="hasExpressionSyntaxError(value ?? '')" data-test-base-expression-error style="color: var(--THEME-error);"><i class="ti ti-alert-triangle"></i> {{ (value ?? '').trim() === '' ? i18n.ts._Parameter.EmptyExpression : i18n.ts._Parameter.SyntaxError }}</div>
						</template>
					</GsTextarea>
					<GsSelect
						v-else-if="paramValue.inputSource === 'envVariable'"
						:modelValue="paramValue.variable"
						:items="[{ label: i18n.ts.None, value: '' }, ...envVariableItems]"
						@update:modelValue="value => emit('edit', { kind: 'envVariable', ...target(), value })"
					/>
					<div v-else-if="paramValue.inputSource === 'automationGraphReference' || paramValue.inputSource === 'automationGraphInline'" style="display: grid; gap: 6px;">
						<GsButton v-if="paramValue.inputSource === 'automationGraphReference'" @click="selectAutomationGraph">{{ selectedAutomationGraph?.nameForReference ?? (paramValue.automationGraphId == null ? i18n.ts.None : i18n.ts._AutomationGraph.MissingGraph) }}</GsButton>
						<GsButton v-else @click="inlineGraphEditorOpen = true">{{ i18n.ts._Parameter.EditGraph }}</GsButton>
						<GsButton v-if="selectedProjectAutomationGraph != null" @click="projectGraphEditorOpen = true">{{ i18n.ts._Parameter.EditGraph }}</GsButton>
						<GsSelect v-if="paramValue.inputSource === 'automationGraphInline'" :modelValue="paramValue.automationGraph.isNormalized ? 'normalized' : 'milliseconds'" :items="graphTimeAxisItems" @update:modelValue="value => updateInlineGraphNormalized(value === 'normalized')">
							<template #label>{{ i18n.ts._Parameter.TimeAxis }}</template>
						</GsSelect>
						<GsInput v-if="paramValue.inputSource === 'automationGraphInline' ? paramValue.automationGraph.isNormalized : selectedAutomationGraph?.isNormalized" type="number" :min="1" :modelValue="paramValue.trimmedDurationMs ?? 1000" @update:modelValue="updateAutomationGraphDuration">
							<template #label>{{ i18n.ts._Parameter.DurationMs }}</template>
						</GsInput>
						<GsSelect :modelValue="paramValue.wrapMode" :items="graphWrapModeItems" @update:modelValue="wrapMode => updateAutomationGraphOptions({ wrapMode })">
							<template #label>{{ i18n.ts._Parameter.WrapMode }}</template>
						</GsSelect>
						<GsSelect v-if="automationGraphEndEnabled !== false" :modelValue="paramValue.offsetMode" :items="graphOffsetModeItems" @update:modelValue="offsetMode => updateAutomationGraphOptions({ offsetMode })">
							<template #label>{{ i18n.ts._Parameter.Offset }}</template>
						</GsSelect>
					</div>
					<div v-else-if="paramValue.inputSource === 'keyframesTimelineInline'" style="display: grid; gap: 6px;">
						{{ paramValue.keyframesTimeline.keyframes.length }} {{ i18n.ts._Parameter.InlineKeyframes }}
					</div>
					<GsSelect
						v-else-if="paramValue.inputSource === 'visualModuleCustomParameterReference'"
						:modelValue="paramValue.parameterId"
						:items="[{ label: i18n.ts.None, value: visualModuleCustomParameterId('') }, ...visualModuleCustomParameterReferenceItems]"
						@update:modelValue="value => emit('edit', { kind: 'visualModuleCustomParameterReference', ...target(), value })"
					/>
					<div v-else-if="paramValue.inputSource === 'node'" style="display: flex; gap: 4px;">
						<GsSelect
							style="flex: 1; min-width: 0;"
							:modelValue="nodeOutputKey(nodeConnection)"
							:items="[{ label: i18n.ts.None, value: null }, ...nodeOutputItems]"
							@update:modelValue="updateParamAsNode"
						/>
						<button class="_button" style="padding: 4px; flex-shrink: 0;" @click="showNodeInputMenu"><i class="ti ti-dots"></i></button>
					</div>
					<div v-else-if="paramValue.inputSource === 'lowerLayerOutput'" style="display: flex; gap: 4px; align-items: center;">
						<span style="flex: 1; min-width: 0;">{{ i18n.ts._Parameter.LowerLayerOutput }}</span>
						<button v-if="imageInputSamplingEnabled" class="_button" style="padding: 4px; flex-shrink: 0;" @click="showLowerLayerOutputSamplingMenu"><i class="ti ti-dots"></i></button>
					</div>
					<div v-else-if="paramValue.inputSource === 'anotherLayerOutput'" style="display: flex; gap: 4px; align-items: center;">
						<GsSelect data-test-image-layer-reference :modelValue="paramValue.layerId" :items="imageLayerItems" @update:modelValue="value => updateAnotherLayerOutput({ layerId: value })"/>
						<GsSelect data-test-layer-output-stage :modelValue="paramValue.outputStage" :items="outputStageItems" @update:modelValue="value => updateAnotherLayerOutput({ outputStage: value })"/>
						<button v-if="imageInputSamplingEnabled" class="_button" :v-tooltip="i18n.ts._Parameter.Sampling" @click="showAnotherLayerOutputSamplingMenu"><i class="ti ti-dots"></i></button>
					</div>
					<span v-else-if="paramValue.inputSource === 'lowerLayerAudio'">{{ i18n.ts._Parameter.LowerLayerAudio }}</span>
					<GsSelect v-else-if="paramValue.inputSource === 'anotherLayerAudio'" :modelValue="paramValue.layerId" :items="anotherLayerAudioItems" @update:modelValue="updateAnotherLayerAudio"/>
					<GsSelect v-else-if="paramValue.inputSource === 'literal' && paramDef.dataType.kind === 'audioSource' && anotherLayerAudioOptions != null" :modelValue="null" :items="[{ label: i18n.ts.None, value: null }]" @update:modelValue="updateParamAsLiteral(null)"/>
					<GsLiteralLeafValueControl
						v-else-if="paramValue.inputSource === 'literal'"
						ref="controlComponent"
						:dataType="paramDef.dataType"
						:control="paramDef.ui.control"
						:title="label ?? paramDef.ui.label"
						:value="paramValue.value"
						@input="updateParamAsLiteral"
						@beginChanging="onBeginChanging"
						@changeContinuous="changeContinuous"
						@changeFinished="onFinishChanging"
						@reset="onReset"
					/>
				</div>
			</template>
			<slot name="actions"></slot>
			<!-- ラベルクリックで表示できるし要らなさそう
			<button class="_button" :class="$style.menuButton" @click="showMenu"><i class="ti ti-dots"></i></button>
			-->
		</div>
	</div>
	<div v-if="expressionModifier != null" :class="$style.expressionModifier" data-test-expression-modifier>
		<div :class="$style.modifierHeader">
			<label>
				<input data-test-expression-modifier-enabled type="checkbox" :checked="expressionModifier.enabled" @change="updateExpressionModifier({ enabled: ($event.target as HTMLInputElement).checked })">
				{{ i18n.ts._Parameter.ExpressionModifier }}
			</label>
			<GsButton v-tooltip="i18n.ts._Parameter.RemoveExpressionModifier" data-test-expression-modifier-remove iconOnly icon="ti ti-x" @click="removeExpressionModifier"/>
		</div>
		<GsTextarea :key="paramPathKey(paramPath)" adaptiveHeight data-test-expression-modifier-code manualSave class="_monospace" :modelValue="expressionModifier.code" @update:modelValue="code => updateExpressionModifier({ code })">
			<template #caption="{ value }">
				<span v-if="expressionModifier.enabled && hasExpressionSyntaxError(value ?? '')" data-test-expression-modifier-error style="color: var(--THEME-error);">{{ (value ?? '').trim() === '' ? i18n.ts._Parameter.EmptyExpression : i18n.ts._Parameter.SyntaxError }}</span>
			</template>
		</GsTextarea>
	</div>
	<Teleport to="body">
		<GsAutomationGraphPointsEditorWindow
			v-if="projectGraphEditorOpen && selectedProjectAutomationGraph != null"
			:automationGraph="selectedProjectAutomationGraph"
			:title="i18n.ts._AutomationGraph.ProjectGraphs + ': ' + selectedProjectAutomationGraph.nameForReference"
			@change="updateProjectGraphPoints"
			@closed="projectGraphEditorOpen = false"
		/>
		<GsAutomationGraphPointsEditorWindow
			v-if="inlineGraphEditorOpen && paramValue.inputSource === 'automationGraphInline'"
			:automationGraph="paramValue.automationGraph"
			:title="label ?? paramDef.ui.label"
			@change="updateInlineGraphPoints"
			@closed="inlineGraphEditorOpen = false"
		/>
	</Teleport>
	<div v-if="paramDef.dataType.kind === 'array'" :class="$style.children">
		<GsVisualParam
			v-for="(element, index) in arrayValues"
			:key="element.id"
			:automationGraphs="automationGraphs"
			:projectAutomationGraphs="projectAutomationGraphs"
			:availableVariables="availableVariables"
			:automationGraphEndEnabled="automationGraphEndEnabled"
			:keyframesEnabled="keyframesEnabled"
			:imageInputEnabled="imageInputEnabled"
			:imageLayerOptions="imageLayerOptions"
			:imageInputSamplingEnabled="imageInputSamplingEnabled"
			:anotherLayerAudioOptions="anotherLayerAudioOptions"
			:visualModule="visualModule"
			:node="node"
			:paramPath="[...paramPath, element.id]"
			:paramDef="getArrayElementDefinition(paramDef)"
			:paramValue="element.binding"
			:label="'[' + index + ']'"
			@edit="emit('edit', $event)"
		>
			<template #actions>
				<GsButton v-tooltip="i18n.ts._Parameter.RemoveElement" iconOnly danger icon="ti ti-x" @click="removeElement(element.id)"/>
			</template>
		</GsVisualParam>
	</div>
	<div v-else-if="paramDef.dataType.kind === 'struct' && structValues" :class="$style.children">
		<GsVisualParam
			v-for="[key, def] in visibleFields"
			:key="key"
			:automationGraphs="automationGraphs"
			:projectAutomationGraphs="projectAutomationGraphs"
			:availableVariables="availableVariables"
			:automationGraphEndEnabled="automationGraphEndEnabled"
			:keyframesEnabled="keyframesEnabled"
			:imageInputEnabled="imageInputEnabled"
			:imageLayerOptions="imageLayerOptions"
			:imageInputSamplingEnabled="imageInputSamplingEnabled"
			:anotherLayerAudioOptions="anotherLayerAudioOptions"
			:visualModule="visualModule"
			:node="node"
			:paramPath="[...paramPath, key]"
			:paramDef="def"
			:paramValue="structValues[key]"
			@edit="emit('edit', $event)"
		/>
	</div>
</div>
</template>

<script lang="ts">
import { deepClone } from '@gs/shared/utility/deep-clone.js';
import GsTextarea from './common/GsTextarea.vue';
import GsNodePort from './GsNodePort.vue';
import GsLiteralLeafValueControl from './GsLiteralLeafValueControl.vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsCondensedLine from './common/GsCondensedLine.vue';
import GsSelect from './common/GsSelect.vue';
import GsAutomationGraphPointsEditorWindow from './GsAutomationGraphPointsEditorWindow.vue';
import type { TimelineLowerLayerOutputBinding, TimelineAnotherLayerOutputBinding, TimelineEffectAnotherLayerOutputBinding, TimelineLayerOutputStage } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';

export type AnotherLayerAudioOption = { value: string; label: string };

export type ParamEdit = { paramPath: ParamPath; mergeKey?: string | null } & (
	| ValueParameterEdit
	| { kind: 'node'; value: NodeOutputReference | null; preserveSampling: boolean }
	| { kind: 'lowerLayerOutput'; value: TimelineLowerLayerOutputBinding }
	| { kind: 'anotherLayerOutput'; value: Extract<EditableParameterBinding, { inputSource: 'anotherLayerOutput' }> }
	| { kind: 'anotherLayerAudio'; value: string | null }
	| { kind: 'visualModuleCustomParameterReference'; value: VisualModuleCustomParameterId }
	| ParameterInputSourceEdit<'node' | 'anotherLayerOutput' | 'lowerLayerOutput' | 'lowerLayerAudio' | 'anotherLayerAudio' | 'visualModuleCustomParameterReference'>
);
</script>

<script lang="ts" setup>
import { getArrayElementDefinition, getStructFieldDefinitions } from '@gs/shared/parameter/parameter-definition.ts';
import { isKeyframesDataType } from '@gs/shared/keyframes/keyframes-timeline.ts';
import { isValueParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import { supportsParameterExpressionModifier } from '@gs/shared/parameter/parameter-expression-modifier.ts';
import type { ParameterExpressionModifier } from '@gs/shared/parameter/value-parameter-binding.ts';
import { visualModuleCustomParameterId } from '@gs/subsystems_visual-module_shared/types.ts';
import { computed, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch, watchEffect } from 'vue';
import { genId } from '@gs/shared/utility/id.ts';
import { getNodeInputDataType, areNodeDataTypesCompatible } from '@gs/shared/data-type/node-compatibility.ts';
import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import * as AiScript from '@syuilo/aiscript';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { Ref } from 'vue';
import type { NodeOutputReference, VisualModule, VisualModuleCustomParameterId, VisualModuleEffectNode } from '@gs/subsystems_visual-module_shared/types.ts';
import type { ExpressionVariableName } from '@gs/shared/expression/expression-environment.ts';
import type { ParamPath } from '@/utility/node-params.ts';
import type { AutomationGraphPlaybackOptions, AutomationGraph, BezierAnchorPoint } from '@gs/shared/automation-graph/automation-graph.ts';
import type { EditableParameterBinding, ParameterInputSourceEdit, ValueParameterEdit } from '@/types/parameter-edit.ts';
import type { MenuItem } from '@/types/menu.ts';
import { i18n } from '@/i18n.ts';
import { useVisualModuleWires } from '@/utility/visual-module-wires.ts';
import { paramPathKey } from '@/utility/node-params.ts';
import { getNodeOutputItems, hasNodeInputTypeMismatch, nodeOutputKey, canConnectNodeDataTypes } from '@/utility/node-outputs.ts';
import { registerWireInput } from '@/utility/wire-drag.ts';
import { getNodeInputSamplingMenuItems } from '@/utility/input-sampling-menu.ts';
import * as ui from '@/ui.ts';
import { appContext } from '@/app.ts';
import { getAvailableAutomationGraphs } from '@gs/glitch-studio_shared/project/automation-graphs.ts';
import { setInlineAutomationGraphNormalized } from '@/utility/automation-graph.ts';

const wireMap = useVisualModuleWires();

const props = defineProps<{
	automationGraphs: readonly AutomationGraph[];
	projectAutomationGraphs?: readonly AutomationGraph[];
	availableVariables: readonly ExpressionVariableName[];
	visualModule?: VisualModule;
	node?: VisualModuleEffectNode;
	paramPath: ParamPath;
	paramDef: ParameterDefinition;
	paramValue: EditableParameterBinding;
	label?: string;
	keyframesEnabled?: boolean;
	imageInputEnabled?: boolean;
	imageInputSamplingEnabled?: boolean;
	imageLayerOptions?: readonly { value: string; label: string }[];
	/** 指定された場合、Timelineの音声入力を有効にする。候補は呼び出し元Sceneが所有する。 */
	anotherLayerAudioOptions?: readonly AnotherLayerAudioOption[];
	automationGraphEndEnabled?: boolean;
}>();

const emit = defineEmits<{ edit: [event: ParamEdit] }>();

const rowEl = useTemplateRef('rowEl');
const portEl = shallowRef<HTMLElement | null>(null);
const arrayValues = computed<ParameterArrayElement<EditableParameterBinding>[]>(() => props.paramDef.dataType.kind === 'array' && props.paramValue.inputSource === 'literal' ? props.paramValue.value : []);
const structValues = computed<Record<string, EditableParameterBinding> | null>(() => props.paramDef.dataType.kind === 'struct' && props.paramValue.inputSource === 'literal' ? props.paramValue.value : null);
const visibleFields = computed(() => {
	if (props.paramDef.dataType.kind !== 'struct') return [];
	const fields: Record<string, ParameterDefinition> = getStructFieldDefinitions(props.paramDef);
	return Object.entries(fields);
});
const canNode = computed(() => props.paramDef.canNode);
const inputDataType = computed(() => getNodeInputDataType(props.paramDef));
const imageInputTypeCompatible = computed(() => areNodeDataTypesCompatible({ kind: 'color' }, inputDataType.value));
const lowerLayerOutputConnection = computed<TimelineLowerLayerOutputBinding | null>(() => props.paramValue.inputSource === 'lowerLayerOutput' && 'fitMode' in props.paramValue ? props.paramValue as TimelineLowerLayerOutputBinding : null);
const anotherLayerOutputConnection = computed(() => props.paramValue.inputSource === 'anotherLayerOutput' && 'fitMode' in props.paramValue ? props.paramValue : null);
const outputStageItems: { value: TimelineLayerOutputStage; label: string }[] = [
	{ value: 'source', label: i18n.ts._Parameter.LayerSourceOutput },
	{ value: 'rendered', label: i18n.ts._Parameter.LayerRenderedOutput },
	{ value: 'composited', label: i18n.ts._Parameter.LayerCompositedOutput },
];
const imageLayerItems = computed(() => {
	const items: { value: string | null; label: string }[] = [{ value: null, label: i18n.ts.None }, ...props.imageLayerOptions ?? []];
	const id = props.paramValue.inputSource === 'anotherLayerOutput' ? props.paramValue.layerId : null;
	if (id != null && !items.some(item => item.value === id)) items.push({ value: id, label: i18n.tsx._Parameter.MissingLayer({ id }) });
	return items;
});

function updateAnotherLayerOutput(changes: Partial<TimelineAnotherLayerOutputBinding>) {
	if (props.paramValue.inputSource !== 'anotherLayerOutput') return;
	emit('edit', { kind: 'anotherLayerOutput', ...target(), value: { ...props.paramValue, ...changes } });
}

const anotherLayerAudioItems = computed(() => {
	const items: { value: string | null; label: string }[] = [{ value: null, label: i18n.ts.None }, ...props.anotherLayerAudioOptions ?? []];
	const id = props.paramValue.inputSource === 'anotherLayerAudio' ? props.paramValue.layerId : null;
	if (id != null && !items.some(item => item.value === id)) items.push({ value: id, label: i18n.tsx._Parameter.MissingLayer({ id }) });
	return items;
});

function updateAnotherLayerAudio(value: string | null) {
	if (props.paramValue.inputSource === 'anotherLayerAudio' && props.paramValue.layerId !== value) emit('edit', { kind: 'anotherLayerAudio', ...target(), value });
}

const paramDefs = computed(() => props.visualModule?.paramDefs ?? []);
const nodes = computed(() => props.visualModule?.nodes ?? []);

const availableAutomationGraphs = computed(() => getAvailableAutomationGraphs(props.automationGraphs, props.projectAutomationGraphs ?? []));
const selectedProjectAutomationGraph = computed(() => selectedAutomationGraph.value != null && !props.automationGraphs.some(graph => graph.id === selectedAutomationGraph.value?.id)
	? props.projectAutomationGraphs?.find(graph => graph.id === selectedAutomationGraph.value?.id) ?? null : null);
const projectGraphEditorOpen = ref(false);
const selectedAutomationGraph = computed(() => {
	const value = props.paramValue;
	return value.inputSource === 'automationGraphReference' ? availableAutomationGraphs.value.find(graph => graph.id === value.automationGraphId) : null;
});
const graphTimeAxisItems = [
	{ label: i18n.ts._Parameter.NormalizedTime, value: 'normalized' },
	{ label: i18n.ts._Parameter.Milliseconds, value: 'milliseconds' },
];
const graphWrapModeItems = [
	{ label: i18n.ts._WrapModes.clamp, value: 'clamp' },
	{ label: i18n.ts._WrapModes.repeat, value: 'repeat' },
	{ label: i18n.ts._WrapModes.repeatMirrored, value: 'repeatMirrored' },
] satisfies { label: string; value: AutomationGraphPlaybackOptions['wrapMode'] }[];
const graphOffsetModeItems = [
	{ label: i18n.ts.Start, value: 'start' },
	{ label: i18n.ts.End, value: 'end' },
] satisfies { label: string; value: AutomationGraphPlaybackOptions['offsetMode'] }[];
const envVariableItems = computed(() => props.availableVariables.map(variable => {
	const label = Object.hasOwn(i18n.ts._EnvVariables, variable)
		? `${i18n.ts._EnvVariables[variable as keyof typeof i18n.ts._EnvVariables]} (${variable})`
		: variable;
	return { label, value: variable };
}));
const visualModuleCustomParameterReferenceItems = computed(() => (props.node == null ? [] : paramDefs.value)
	.filter(def => !def.canNode && (def.dataType.kind === 'audioSource') === (props.paramDef.dataType.kind === 'audioSource'))
	.filter(def => def.dataType.kind !== 'colorRamp' && props.paramDef.dataType.kind !== 'colorRamp' || areDataTypesEqual(def.dataType, props.paramDef.dataType))
	.map(def => ({ label: `${def.ui.label} (${def.nameForReference})`, value: def.id })));
const nodeOutputItems = computed(() => props.node == null ? [] : getNodeOutputItems(nodes.value, props.node.id, inputDataType.value, paramDefs.value));
const nodeConnection = computed<NodeOutputReference | null>(() => props.paramValue.inputSource === 'node' && props.paramValue.nodeId != null ? props.paramValue : null);
const controlComponent = useTemplateRef('controlComponent');
const inlineGraphEditorOpen = ref(false);

let commandMergeKey: string | null = null;
let mounted = true;
onBeforeUnmount(() => { mounted = false; });
watch([() => props.visualModule, () => JSON.stringify([props.node?.id, props.paramPath, props.paramValue.inputSource])], () => {
	commandMergeKey = null;
	inlineGraphEditorOpen.value = false;
});

function target() {
	return { paramPath: props.paramPath };
}

watchEffect(onCleanup => {
	const row = rowEl.value;
	if (!row || !canNode.value || props.node == null) return;
	onCleanup(registerWireInput(row, connectNode,
		connection => nodeOutputItems.value.find(item => item.value === nodeOutputKey(connection))?.typeCompatible ?? null));
});

watchEffect(onCleanup => {
	const el = portEl.value;
	const nodeId = props.node?.id;
	const key = paramPathKey(props.paramPath);
	if (el == null || nodeId == null || !canNode.value) return;
	wireMap.in[nodeId] ??= {};
	wireMap.in[nodeId][key] = el;
	onCleanup(() => {
		if (wireMap.in[nodeId]?.[key] === el) delete wireMap.in[nodeId][key];
	});
});

const aisParser = new AiScript.Parser();
const expressionModifier = computed(() => isValueParameterBinding(props.paramValue) ? props.paramValue.expressionModifier ?? null : null);

function hasExpressionSyntaxError(code: string): boolean {
	try { return code.trim() === '' || aisParser.parse(code).length === 0; } catch { return true; }
}

function updateInlineGraphNormalized(isNormalized: boolean) {
	if (props.paramValue.inputSource !== 'automationGraphInline' || props.paramValue.automationGraph.isNormalized === isNormalized) return;
	emit('edit', { kind: 'automationGraphInline', ...target(), value: setInlineAutomationGraphNormalized(props.paramValue, isNormalized) });
}

function updateAutomationGraphOptions(options: Partial<AutomationGraphPlaybackOptions>) {
	if (props.paramValue.inputSource === 'automationGraphInline') {
		emit('edit', { kind: 'automationGraphInline', ...target(), value: { ...deepClone(props.paramValue), ...options } });
		return;
	}
	if (props.paramValue.inputSource !== 'automationGraphReference') return;
	emit('edit', {
		kind: 'automationGraphReference',
		...target(),
		value: props.paramValue.automationGraphId,
		options,
	});
}

function updateInlineGraphPoints(points: BezierAnchorPoint[], mergeKey: string | null) {
	if (!mounted || props.paramValue.inputSource !== 'automationGraphInline') return;
	emit('edit', {
		kind: 'automationGraphInline',
		...target(),
		mergeKey,
		value: { ...deepClone(props.paramValue), automationGraph: { ...props.paramValue.automationGraph, points: deepClone(points) } },
	});
}

function updateAutomationGraphDuration(trimmedDurationMs: number) {
	if (Number.isFinite(trimmedDurationMs) && trimmedDurationMs > 0) updateAutomationGraphOptions({ trimmedDurationMs });
}

function updateProjectGraphPoints(points: BezierAnchorPoint[], mergeKey: string | null) {
	if (selectedProjectAutomationGraph.value != null) appContext.projectContext.stateManager.commit('updateProjectAutomationGraph', { automationGraph: { ...selectedProjectAutomationGraph.value, points } }, mergeKey);
}

function selectAutomationGraph(ev: PointerEvent) {
	ui.popupMenu([
		{ text: i18n.ts.None, action: () => emit('edit', { kind: 'automationGraphReference', ...target(), value: null }) },
		...([
			{ graphs: props.automationGraphs, label: i18n.ts._AutomationGraph.LocalGraphs },
			{ graphs: props.projectAutomationGraphs ?? [], label: i18n.ts._AutomationGraph.ProjectGraphs },
		]).flatMap<MenuItem>(({ graphs, label }) => graphs.length === 0 ? [] : [
			{ type: 'label', text: label },
			...graphs.map(automationGraph => ({
				text: automationGraph.nameForReference,
				action: () => emit('edit', { kind: 'automationGraphReference', ...target(), value: automationGraph.id }),
			})),
		]),
	], ev.currentTarget ?? ev.target);
}

function getMenu() {
	const menuItems: MenuItem[] = [{
		text: i18n.ts._Parameter.DirectEdit,
		icon: 'ti ti-forms',
		action: () => controlComponent.value?.directEdit?.(),
	}, {
		text: i18n.ts.Reset,
		icon: 'ti ti-refresh',
		danger: true,
		action: () => emit('edit', { kind: 'reset', ...target() }),
	}];

	// コンテナ自体は静的な構造を維持し、値の種類を変更できるのは末端だけにする。
	if (props.paramDef.dataType.kind !== 'array' && props.paramDef.dataType.kind !== 'struct') {
		menuItems.push({ type: 'label', text: i18n.ts._Parameter.InputSource });
		const types: { text: string; inputSource: EditableParameterBinding['inputSource']; icon: string }[] = [
			{ text: i18n.ts._Parameter.Literal, inputSource: 'literal', icon: 'ti ti-adjustments-horizontal' },
			{ text: i18n.ts._Parameter.EnvironmentVariable, inputSource: 'envVariable', icon: 'ti ti-variable' },
			{ text: i18n.ts._Parameter.Expression, inputSource: 'expression', icon: 'ti ti-math-function' },
			{ text: i18n.ts._Parameter.Keyframes, inputSource: 'keyframesTimelineInline', icon: 'ti ti-timeline' },
			{ text: i18n.ts._Parameter.AutomationGraphReference, inputSource: 'automationGraphReference', icon: 'ti ti-ease-in-out-control-points' },
			{ text: i18n.ts._Parameter.AutomationGraphInline, inputSource: 'automationGraphInline', icon: 'ti ti-ease-in-out-control-points' },
		];
		if (props.paramDef.dataType.kind === 'audioSource') {
			types.splice(1);
			if (props.anotherLayerAudioOptions != null) types.push(
				{ text: i18n.ts._Parameter.LowerLayerAudio, inputSource: 'lowerLayerAudio', icon: 'ti ti-wave-sine' },
				{ text: i18n.ts._Parameter.AnotherLayerAudio, inputSource: 'anotherLayerAudio', icon: 'ti ti-wave-sine' },
			);
		}
		if (props.node != null) types.push({ text: i18n.ts._Parameter.CustomParameter, inputSource: 'visualModuleCustomParameterReference', icon: 'ti ti-wifi' });
		if (canNode.value && props.node != null) types.push({ text: i18n.ts._Parameter.Node, inputSource: 'node', icon: 'ti ti-plug' });
		if (props.imageInputEnabled && canNode.value && canConnectNodeDataTypes({ kind: 'color' }, inputDataType.value)) {
			types.push({ text: i18n.ts._Parameter.LowerLayerOutput, inputSource: 'lowerLayerOutput', icon: 'ti ti-stack-2' });
			if (props.imageLayerOptions != null) types.push({ text: i18n.ts._Parameter.AnotherLayerOutput, inputSource: 'anotherLayerOutput', icon: 'ti ti-stack' });
		}
		for (const { text, inputSource, icon } of types) {
			if (props.paramDef.dataType.kind === 'colorRamp' && ['automationGraphReference', 'automationGraphInline'].includes(inputSource)) continue;
			if (inputSource === 'keyframesTimelineInline' && (!props.keyframesEnabled || !isKeyframesDataType(props.paramDef.dataType))) continue;
			menuItems.push({
				text,
				icon,
				active: props.paramValue.inputSource === inputSource,
				action: () => emit('edit', { kind: 'inputSource', ...target(), inputSource }),
			});
		}
		if (expressionModifier.value == null && supportsParameterExpressionModifier(props.paramDef, props.paramValue)) {
			menuItems.push({
				type: 'divider',
			});
			menuItems.push({
				text: i18n.ts._Parameter.AddExpressionModifier,
				icon: 'ti ti-math-function',
				action: () => emit('edit', { kind: 'expressionModifier', ...target(), value: { enabled: true, code: 'VALUE' } }),
			});
		}
	}
	return menuItems;
}

function showMenu(ev: PointerEvent) {
	ui.popupMenu(getMenu(), ev.currentTarget ?? ev.target);
}

function showNodeInputMenu(ev: PointerEvent) {
	const abortController = new AbortController();

	const menuItems: MenuItem[] = [{
		text: i18n.ts._Parameter.Disconnect,
		danger: true,
		action: () => {
			abortController.abort();
			connectNode(null);
		},
	}, {
		type: 'divider',
	}, {
		type: 'label',
		text: i18n.ts._Parameter.Sampling,
	}];

	if (nodeConnection.value != null) {
		const nodeInputSamplingMenuItems = getNodeInputSamplingMenuItems(nodeConnection as Ref<NodeOutputReference>, value => connectNode(value, false));
		menuItems.push(...nodeInputSamplingMenuItems);
	}

	ui.popupMenu(menuItems, ev.currentTarget ?? ev.target, {
		abortSignal: abortController.signal,
	});
}

function showAnotherLayerOutputSamplingMenu(ev: PointerEvent) {
	if (anotherLayerOutputConnection.value == null) return;
	ui.popupMenu(getNodeInputSamplingMenuItems(anotherLayerOutputConnection as Ref<TimelineEffectAnotherLayerOutputBinding>,
		value => emit('edit', { kind: 'anotherLayerOutput', ...target(), value })), ev.currentTarget ?? ev.target);
}

function showLowerLayerOutputSamplingMenu(ev: PointerEvent) {
	if (lowerLayerOutputConnection.value == null) return;
	ui.popupMenu(getNodeInputSamplingMenuItems(lowerLayerOutputConnection as Ref<TimelineLowerLayerOutputBinding>,
		value => emit('edit', { kind: 'lowerLayerOutput', ...target(), value })), ev.currentTarget ?? ev.target);
}

function onRowContextmenu(ev: PointerEvent) {
	ui.contextMenu(getMenu(), ev);
}

function onBeginChanging() {
	commandMergeKey = genId();
}

function changeContinuous(value: any) {
	if (mounted) emit('edit', {
		kind: 'literal',
		...target(),
		value,
		mergeKey: commandMergeKey,
	});
}

function onFinishChanging() {
	commandMergeKey = null;
}

function updateParamAsLiteral(value: any) {
	if (mounted) emit('edit', { kind: 'literal', ...target(), value });
}

function updateParamAsExpression(value: string) {
	if (mounted) emit('edit', {
		kind: 'expression',
		...target(),
		value,
	});
}

function updateExpressionModifier(changes: Partial<ParameterExpressionModifier>) {
	if (!mounted || expressionModifier.value == null) return;
	emit('edit', { kind: 'expressionModifier', ...target(), value: { ...expressionModifier.value, ...changes } });
}

function removeExpressionModifier() {
	emit('edit', { kind: 'expressionModifier', ...target(), value: null });
}

function connectNode(value: NodeOutputReference | null, preserveSampling = true) {
	if (!canNode.value) return;
	// 別のVisualModuleや、グラフ切り替え前の候補へ接続しない。
	if (value != null && !nodeOutputItems.value.some(item => item.value === nodeOutputKey(value))) return;
	if (mounted) emit('edit', {
		kind: 'node',
		...target(),
		value,
		preserveSampling,
	});
}

function updateParamAsNode(key: string | null) {
	connectNode(nodeOutputItems.value.find(item => item.value === key)?.connection ?? null);
}

function addElement() {
	emit('edit', { kind: 'addElement', ...target() });
}

function removeElement(elementId: string) {
	emit('edit', { kind: 'removeElement', ...target(), elementId });
}

function onReset() {
	emit('edit', { kind: 'reset', ...target() });
}
</script>

<style module lang="scss">
.root {
	min-width: 0;
}

.row {
	display: flex;
	padding: 3px 10px;
	box-sizing: border-box;
	min-height: 30px;

	&:hover {
		background: #ffffff08;

		.menuButton {
			opacity: 1; // TODO: opacityを使わない実装にする
		}
	}
}

.paramHeader {
	display: flex;
	align-items: center;
	gap: 8px;
	place-content: center left;
	width: 35%;
	box-sizing: border-box;
	padding-right: 12px;
	flex-shrink: 0;

	&.isDyamic {
	}
}

.paramLabel {
	flex: 1;
	min-width: 0;
	white-space: nowrap;
	text-overflow: ellipsis;
	overflow: clip;
	cursor: pointer;
}

.typeIcon {
}

.paramBody {
	display: flex;
	width: 65%;
	min-width: 0;
	flex-shrink: 1;
	align-items: center;
	justify-content: flex-end;
	gap: 8px;
}

.control {
	flex: 1;
	min-width: 0;
}

.children {
	margin-left: 16px;
	border-left: 1px solid #ffffff18;

	&:hover {
		border-left: 1px solid #ffffff30;
	}
}

.expressionModifier {
	margin: 4px 10px 8px;
	padding: 8px;
	border-left: 2px solid var(--THEME-accent);
	background: #ffffff05;
}

.modifierHeader {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 6px;

	label {
		display: flex;
		align-items: center;
		gap: 6px;
	}
}

.count {
	opacity: 0.6;
}

.typeWarning {
	color: var(--THEME-warn);
}

.menuButton {
	opacity: 0.3; // TODO: opacityを使わない実装にする
}
</style>
