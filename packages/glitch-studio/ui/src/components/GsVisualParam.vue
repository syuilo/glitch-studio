<template>
<div :class="$style.root">
	<div ref="rowEl" :class="$style.row" data-wire-input-row @contextmenu.prevent.stop="onRowContextmenu">
		<div :class="[$style.paramHeader, { [$style.isDyamic]: paramValue.inputSource !== 'literal' }]">
			<button v-if="paramDef.dataType.kind === 'array' || paramDef.dataType.kind === 'struct'" class="_button"><i class="ti ti-chevron-down" style="vertical-align: middle;"></i></button>
			<GsNodePort v-else-if="canNode && node != null" :dataType="inputDataType" style="cursor: pointer;" @pointerdown.stop @click.stop="showNodeInputMenu" @update:element="portEl = $event"/>
			<div v-else style="width: 24px; height: 24px; line-height: 24px; text-align: center; opacity: 0.2;"><i class="ti ti-point"></i></div>

			<div :class="$style.paramLabel" @click="showMenu">
				<GsCondensedLine>{{ label ?? paramDef.ui.label }}</GsCondensedLine>
			</div>
			<div style="height: 100%; place-content: center;">
				<i v-if="paramValue.inputSource === 'envVariable'" v-tooltip="'Environment Variable'" class="ti ti-variable" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'expression'" v-tooltip="'Expression'" class="ti ti-math-function" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'externalCustomParameterInput'" v-tooltip="'Parameter'" class="ti ti-wifi" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'node'" v-tooltip="'Node'" class="ti ti-plug" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'layerInput'" v-tooltip="'Layers below'" class="ti ti-stack-2" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'keyframesTimelineInline'" v-tooltip="'Keyframes'" class="ti ti-timeline" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'automationGraphReference' || paramValue.inputSource === 'automationGraphInline'" v-tooltip="'AutomationGraph'" class="ti ti-ease-in-out-control-points" :class="$style.typeIcon"></i>
			</div>
		</div>
		<div :class="$style.paramBody">
			<template v-if="paramDef.dataType.kind === 'array'">
				<span :class="$style.count">{{ arrayValues.length }}</span>
				<GsButton small iconOnly title="Add element" @click="addElement"><i class="ti ti-plus"></i></GsButton>
			</template>
			<template v-else-if="paramDef.dataType.kind !== 'struct'">
				<i v-if="hasNodeInputTypeMismatch(nodes, nodeConnection, inputDataType, paramDefs) || (paramValue.inputSource === 'layerInput' && !layerInputTypeCompatible)" v-tooltip="'Data type mismatch'" class="ti ti-alert-triangle" :class="$style.typeWarning"></i>
				<div :class="$style.control">
					<GsInput v-if="paramValue.inputSource === 'expression'" type="text" class="_monospace" :modelValue="paramValue.expression" @focusin="onBeginChanging" @focusout="onFinishChanging" @update:modelValue="updateParamAsExpression">
						<template #caption>
							<div v-if="isExpressionSyntaxError" style="color: var(--THEME-error);"><i class="ti ti-alert-triangle"></i> Syntax error!</div>
						</template>
					</GsInput>
					<GsSelect
						v-else-if="paramValue.inputSource === 'envVariable'"
						small
						:modelValue="paramValue.variable"
						:items="[{ label: i18n.ts.None, value: '' }, ...envVariableItems]"
						@update:modelValue="value => emit('edit', { kind: 'envVariable', ...target(), value })"
					/>
					<div v-else-if="paramValue.inputSource === 'automationGraphReference' || paramValue.inputSource === 'automationGraphInline'" style="display: grid; gap: 6px;">
						<GsButton v-if="paramValue.inputSource === 'automationGraphReference'" small @click="selectAutomationGraph">{{ selectedAutomationGraph?.name ?? i18n.ts.None }}</GsButton>
						<GsButton v-else small @click="inlineGraphEditorOpen = true">Edit graph</GsButton>
						<GsSelect v-if="paramValue.inputSource === 'automationGraphInline'" small :modelValue="paramValue.automationGraph.isNormalized ? 'normalized' : 'milliseconds'" :items="graphTimeAxisItems" @update:modelValue="value => updateInlineGraphNormalized(value === 'normalized')">
							<template #label>Time axis</template>
						</GsSelect>
						<GsInput v-if="selectedAutomationGraph?.isNormalized" type="number" small :min="1" :modelValue="paramValue.trimmedDurationMs ?? 1000" @update:modelValue="updateAutomationGraphDuration">
							<template #label>Duration (ms)</template>
						</GsInput>
						<GsSelect small :modelValue="paramValue.wrapMode" :items="graphWrapModeItems" @update:modelValue="wrapMode => updateAutomationGraphOptions({ wrapMode })">
							<template #label>Wrap mode</template>
						</GsSelect>
						<GsSelect v-if="automationGraphEndEnabled !== false" small :modelValue="paramValue.offsetMode" :items="graphOffsetModeItems" @update:modelValue="offsetMode => updateAutomationGraphOptions({ offsetMode })">
							<template #label>Offset</template>
						</GsSelect>
					</div>
					<div v-else-if="paramValue.inputSource === 'keyframesTimelineInline'" style="display: grid; gap: 6px;">
						{{ paramValue.keyframesTimeline.keyframes.length }} keyframes
					</div>
					<GsSelect
						v-else-if="paramValue.inputSource === 'externalCustomParameterInput'"
						small
						:modelValue="paramValue.parameterId"
						:items="[{ label: i18n.ts.None, value: visualModuleCustomParameterId('') }, ...externalCustomParameterInputItems]"
						@update:modelValue="value => emit('edit', { kind: 'externalCustomParameterInput', ...target(), value })"
					/>
					<div v-else-if="paramValue.inputSource === 'node'" style="display: flex; gap: 4px;">
						<GsSelect
							style="flex: 1;"
							small
							:modelValue="nodeOutputKey(nodeConnection)"
							:items="[{ label: i18n.ts.None, value: null }, ...nodeOutputItems]"
							@update:modelValue="updateParamAsNode"
						/>
						<button class="_button" style="padding: 4px;" @click="showNodeInputMenu"><i class="ti ti-dots"></i></button>
					</div>
					<div v-else-if="paramValue.inputSource === 'layerInput'" style="display: flex; gap: 4px; align-items: center;">
						<span style="flex: 1;">Layers below</span>
						<button class="_button" style="padding: 4px;" @click="showLayerInputSamplingMenu"><i class="ti ti-dots"></i></button>
					</div>
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
	<Teleport to="body">
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
			:availableVariables="availableVariables"
			:automationGraphEndEnabled="automationGraphEndEnabled"
			:keyframesEnabled="keyframesEnabled"
			:layerInputEnabled="layerInputEnabled"
			:visualModule="visualModule"
			:node="node"
			:paramPath="[...paramPath, element.id]"
			:paramDef="getArrayElementDefinition(paramDef)"
			:paramValue="element.binding"
			:label="'[' + index + ']'"
			@edit="emit('edit', $event)"
		>
			<template #actions>
				<GsButton small iconOnly danger title="Remove element" @click="removeElement(element.id)"><i class="ti ti-x"></i></GsButton>
			</template>
		</GsVisualParam>
	</div>
	<div v-else-if="paramDef.dataType.kind === 'struct' && structValues" :class="$style.children">
		<GsVisualParam
			v-for="[key, def] in visibleFields"
			:key="key"
			:automationGraphs="automationGraphs"
			:availableVariables="availableVariables"
			:automationGraphEndEnabled="automationGraphEndEnabled"
			:keyframesEnabled="keyframesEnabled"
			:layerInputEnabled="layerInputEnabled"
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
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

export type ParamEdit = { paramPath: ParamPath; mergeKey?: string | null } & (
	| { kind: 'literal'; value: any }
	| { kind: 'automationGraphInline'; value: Extract<ParameterBinding, { inputSource: 'automationGraphInline' }> }
	| { kind: 'envVariable'; value: ExpressionVariableName }
	| { kind: 'expression'; value: string }
	| { kind: 'automationGraphReference'; value: string | null; options?: Partial<AutomationGraphPlaybackOptions> }
	| { kind: 'keyframesTimelineInline'; value: Extract<ParameterBinding, { inputSource: 'keyframesTimelineInline' }> }
	| { kind: 'node'; value: NodeOutputReference | null; preserveSampling: boolean }
	| { kind: 'layerInput'; value: Extract<ParameterBinding, { inputSource: 'layerInput' }> }
	| { kind: 'externalCustomParameterInput'; value: VisualModuleCustomParameterId }
	| { kind: 'inputSource'; inputSource: ParameterBinding['inputSource'] }
	| { kind: 'reset' }
	| { kind: 'addElement' }
	| { kind: 'removeElement'; elementId: string }
);
</script>

<script lang="ts" setup>
import { getArrayElementDefinition, getStructFieldDefinitions } from '@gs/shared/parameter/parameter-definition.ts';
import { isKeyframesDataType } from '@gs/shared/keyframes/keyframes-timeline.ts';
import { visualModuleCustomParameterId } from '@gs/subsystems_visual-module_shared/types.ts';
import { computed, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch, watchEffect } from 'vue';
import { genId } from '@gs/shared/utility/id.ts';
import { getNodeInputDataType, areNodeDataTypesCompatible } from '@gs/shared/data-type/node-compatibility.ts';
import * as AiScript from '@syuilo/aiscript';
import GsNodePort from './GsNodePort.vue';
import GsLiteralLeafValueControl from './GsLiteralLeafValueControl.vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsCondensedLine from './common/GsCondensedLine.vue';
import GsSelect from './common/GsSelect.vue';
import GsAutomationGraphPointsEditorWindow from './GsAutomationGraphPointsEditorWindow.vue';
import type { Ref } from 'vue';
import type { NodeOutputReference, VisualModule, VisualModuleCustomParameterId, VisualModuleEffectNode } from '@gs/subsystems_visual-module_shared/types.ts';
import type { ExpressionVariableName } from '@gs/shared/expression/expression-environment.ts';
import type { ParamPath } from '@/utility/node-params.ts';
import type { AutomationGraphPlaybackOptions, AutomationGraph, BezierAnchorPoint } from '@gs/shared/automation-graph/automation-graph.ts';
import type { ParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import type { MenuItem } from '@/types/menu.ts';
import { i18n } from '@/i18n.ts';
import { useVisualModuleWires } from '@/utility/visual-module-wires.ts';
import { paramPathKey } from '@/utility/node-params.ts';
import { getNodeOutputItems, hasNodeInputTypeMismatch, nodeOutputKey, canConnectNodeDataTypes } from '@/utility/node-outputs.ts';
import { registerWireInput } from '@/utility/wire-drag.ts';
import { getNodeInputSamplingMenuItems } from '@/utility/input-sampling-menu.ts';
import * as ui from '@/ui.ts';
import { setInlineAutomationGraphNormalized } from '@/utility/automation-graph.ts';

const wireMap = useVisualModuleWires();

const props = defineProps<{
	automationGraphs: readonly AutomationGraph[];
	availableVariables: readonly ExpressionVariableName[];
	visualModule?: VisualModule;
	node?: VisualModuleEffectNode;
	paramPath: ParamPath;
	paramDef: ParameterDefinition;
	paramValue: ParameterBinding;
	label?: string;
	keyframesEnabled?: boolean;
	layerInputEnabled?: boolean;
	automationGraphEndEnabled?: boolean;
}>();

const emit = defineEmits<{ edit: [event: ParamEdit] }>();

const rowEl = useTemplateRef('rowEl');
const portEl = shallowRef<HTMLElement | null>(null);
const arrayValues = computed<ParameterArrayElement[]>(() => props.paramDef.dataType.kind === 'array' && props.paramValue.inputSource === 'literal' ? props.paramValue.value : []);
const structValues = computed<Record<string, ParameterBinding> | null>(() => props.paramDef.dataType.kind === 'struct' && props.paramValue.inputSource === 'literal' ? props.paramValue.value : null);
const visibleFields = computed(() => {
	if (props.paramDef.dataType.kind !== 'struct') return [];
	const fields: Record<string, ParameterDefinition> = getStructFieldDefinitions(props.paramDef);
	return Object.entries(fields);
});
const canNode = computed(() => props.paramDef.canNode);
const inputDataType = computed(() => getNodeInputDataType(props.paramDef));
const layerInputTypeCompatible = computed(() => areNodeDataTypesCompatible({ kind: 'color' }, inputDataType.value));
const layerInputConnection = computed(() => props.paramValue.inputSource === 'layerInput' ? props.paramValue : null);
const paramDefs = computed(() => props.visualModule?.paramDefs ?? []);
const nodes = computed(() => props.visualModule?.nodes ?? []);

const selectedAutomationGraph = computed(() => {
	const value = props.paramValue;
	return value.inputSource === 'automationGraphInline' ? { ...value.automationGraph, name: 'Inline graph' }
		: value.inputSource === 'automationGraphReference' ? props.automationGraphs.find(graph => graph.id === value.automationGraphId) : undefined;
});
const graphTimeAxisItems = [
	{ label: 'Normalized (0–1)', value: 'normalized' },
	{ label: 'Milliseconds', value: 'milliseconds' },
];
const graphWrapModeItems = [
	{ label: 'Clamp', value: 'clamp' },
	{ label: 'Repeat', value: 'repeat' },
	{ label: 'Repeat mirrored', value: 'repeatMirrored' },
] satisfies { label: string; value: AutomationGraphPlaybackOptions['wrapMode'] }[];
const graphOffsetModeItems = [
	{ label: 'Start', value: 'start' },
	{ label: 'End', value: 'end' },
] satisfies { label: string; value: AutomationGraphPlaybackOptions['offsetMode'] }[];
const envVariableItems = computed(() => props.availableVariables.map(variable => ({ label: variable.startsWith('TEST_') ? variable : `${i18n.t(`_EnvVariables.${variable}`)} (${variable})`, value: variable })));
const externalCustomParameterInputItems = computed(() => (props.node == null ? [] : paramDefs.value)
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
const isExpressionSyntaxError = computed(() => {
	if (props.paramValue.inputSource !== 'expression') return false;
	try {
		aisParser.parse(props.paramValue.expression);
		return false;
	} catch {
		return true;
	}
});

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
	emit('edit', { kind: 'automationGraphReference', ...target(), value: props.paramValue.automationGraphId, options });
}

function updateInlineGraphPoints(points: BezierAnchorPoint[], mergeKey: string | null) {
	if (!mounted || props.paramValue.inputSource !== 'automationGraphInline') return;
	emit('edit', {
		kind: 'automationGraphInline', ...target(), mergeKey,
		value: { ...deepClone(props.paramValue), automationGraph: { ...props.paramValue.automationGraph, points: deepClone(points) } },
	});
}

function updateAutomationGraphDuration(trimmedDurationMs: number) {
	if (Number.isFinite(trimmedDurationMs) && trimmedDurationMs > 0) updateAutomationGraphOptions({ trimmedDurationMs });
}

function selectAutomationGraph(ev: PointerEvent) {
	ui.popupMenu([
		{ text: '(none)', action: () => emit('edit', { kind: 'automationGraphReference', ...target(), value: null }) },
		...props.automationGraphs.map(a => ({
			text: a.name,
			action: () => emit('edit', { kind: 'automationGraphReference', ...target(), value: a.id }),
		})),
	], ev.currentTarget ?? ev.target);
}

function getMenu() {
	const menuItems: MenuItem[] = [{
		text: 'Direct Edit',
		icon: 'ti ti-forms',
		action: () => controlComponent.value?.directEdit?.(),
	}, {
		text: 'Reset',
		icon: 'ti ti-refresh',
		danger: true,
		action: () => emit('edit', { kind: 'reset', ...target() }),
	}];

	// コンテナ自体は静的な構造を維持し、値の種類を変更できるのは末端だけにする。
	if (props.paramDef.dataType.kind !== 'array' && props.paramDef.dataType.kind !== 'struct') {
		menuItems.push({ type: 'label', text: 'Input source' });
		const types: { text: string; inputSource: ParameterBinding['inputSource']; icon: string }[] = [
			{ text: 'Literal', inputSource: 'literal', icon: 'ti ti-adjustments-horizontal' },
			{ text: 'Environment Variable', inputSource: 'envVariable', icon: 'ti ti-variable' },
			{ text: 'Expression', inputSource: 'expression', icon: 'ti ti-math-function' },
			{ text: 'Keyframes', inputSource: 'keyframesTimelineInline', icon: 'ti ti-timeline' },
			{ text: 'Automation Graph (Reference)', inputSource: 'automationGraphReference', icon: 'ti ti-ease-in-out-control-points' },
			{ text: 'Automation Graph (Inline)', inputSource: 'automationGraphInline', icon: 'ti ti-ease-in-out-control-points' },
		];
		if (props.node != null) types.push({ text: 'Custom Parameter', inputSource: 'externalCustomParameterInput', icon: 'ti ti-wifi' });
		if (canNode.value && props.node != null) types.push({ text: 'Node', inputSource: 'node', icon: 'ti ti-plug' });
		if (props.layerInputEnabled && canConnectNodeDataTypes({ kind: 'color' }, inputDataType.value)) {
			types.push({ text: 'Layers below', inputSource: 'layerInput', icon: 'ti ti-stack-2' });
		}
		for (const { text, inputSource, icon } of types) {
			if (inputSource === 'keyframesTimelineInline' && (!props.keyframesEnabled || !isKeyframesDataType(props.paramDef.dataType))) continue;
			menuItems.push({
				text,
				icon,
				active: props.paramValue.inputSource === inputSource,
				action: () => emit('edit', { kind: 'inputSource', ...target(), inputSource }),
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
		text: 'Disconnect',
		danger: true,
		action: () => {
			abortController.abort();
			connectNode(null);
		},
	}, {
		type: 'divider',
	}, {
		type: 'label',
		text: 'Sampling',
	}];

	if (nodeConnection.value != null) {
		const nodeInputSamplingMenuItems = getNodeInputSamplingMenuItems(nodeConnection as Ref<NodeOutputReference>, value => connectNode(value, false));
		menuItems.push(...nodeInputSamplingMenuItems);
	}

	ui.popupMenu(menuItems, ev.currentTarget ?? ev.target, {
		abortSignal: abortController.signal,
	});
}

function showLayerInputSamplingMenu(ev: PointerEvent) {
	if (layerInputConnection.value == null) return;
	ui.popupMenu(getNodeInputSamplingMenuItems(layerInputConnection as Ref<Extract<ParameterBinding, { inputSource: 'layerInput' }>>,
		value => emit('edit', { kind: 'layerInput', ...target(), value })), ev.currentTarget ?? ev.target);
}

function onRowContextmenu(ev: PointerEvent) {
	ui.contextMenu(getMenu(), ev);
}

function onBeginChanging() {
	commandMergeKey = genId();
}

function changeContinuous(value: any) {
	if (mounted) emit('edit', { kind: 'literal', ...target(), value, mergeKey: commandMergeKey });
}

function onFinishChanging() {
	commandMergeKey = null;
}

function updateParamAsLiteral(value: any) {
	if (mounted) emit('edit', { kind: 'literal', ...target(), value });
}

function updateParamAsExpression(value: string) {
	if (mounted) emit('edit', { kind: 'expression', ...target(), value, mergeKey: commandMergeKey });
}

function connectNode(value: NodeOutputReference | null, preserveSampling = true) {
	if (!canNode.value) return;
	// 別のVisualModuleや、グラフ切り替え前の候補へ接続しない。
	if (value != null && !nodeOutputItems.value.some(item => item.value === nodeOutputKey(value))) return;
	if (mounted) emit('edit', { kind: 'node', ...target(), value, preserveSampling });
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
	font-size: 95%;

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
