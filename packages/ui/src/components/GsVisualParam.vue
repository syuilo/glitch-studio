<template>
<div :class="$style.root">
	<div ref="rowEl" :class="$style.row" data-wire-input-row @contextmenu.prevent.stop="onRowContextmenu">
		<div :class="[$style.paramHeader, { [$style.isDyamic]: paramValue.inputSource !== 'literal' }]">
			<button v-if="paramDef.dataType === 'array' || paramDef.dataType === 'struct'" class="_button"><i class="ti ti-chevron-down" style="vertical-align: middle;"></i></button>
			<div :class="$style.paramLabel" @click="showMenu">
				<GsCondensedLine>{{ label ?? paramDef.ui.label }}</GsCondensedLine>
			</div>
			<div style="height: 100%; place-content: center;">
				<i v-if="paramValue.inputSource === 'envVariable'" v-tooltip="'Environment Variable'" class="ti ti-variable" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'expression'" v-tooltip="'Expression'" class="ti ti-math-function" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'externalCustomParameterInput'" v-tooltip="'Parameter'" class="ti ti-wifi" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'node'" v-tooltip="'Node'" class="ti ti-plug" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'automationGraphReference' || paramValue.inputSource === 'automationGraphInline'" v-tooltip="'AutomationGraph'" class="ti ti-ease-in-out-control-points" :class="$style.typeIcon"></i>
			</div>
		</div>
		<div :class="$style.paramBody">
			<template v-if="paramDef.dataType === 'array'">
				<span :class="$style.count">{{ arrayValues.length }}</span>
				<GsButton small iconOnly title="Add element" @click="addElement"><i class="ti ti-plus"></i></GsButton>
			</template>
			<template v-else-if="paramDef.dataType !== 'struct'">
				<GsNodePort v-if="canNode" :dataType="inputDataType" style="cursor: pointer;" @pointerdown.stop @click.stop="showNodeInputMenu" @update:element="portEl = $event"/>
				<i v-if="hasNodeInputTypeMismatch(nodes, nodeConnection, inputDataType, paramDefs)" v-tooltip="'Data type mismatch'" class="ti ti-alert-triangle" :class="$style.typeWarning"></i>
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
						<GsInput v-if="selectedAutomationGraph?.isNormalized" type="number" small :min="1" :modelValue="paramValue.durationMs ?? 1000" @update:modelValue="updateAutomationGraphDuration">
							<template #label>Duration (ms)</template>
						</GsInput>
						<GsSelect small :modelValue="paramValue.wrapMode" :items="graphWrapModeItems" @update:modelValue="wrapMode => updateAutomationGraphOptions({ wrapMode })">
							<template #label>Wrap mode</template>
						</GsSelect>
						<GsSelect small :modelValue="paramValue.offsetMode" :items="graphOffsetModeItems" @update:modelValue="offsetMode => updateAutomationGraphOptions({ offsetMode })">
							<template #label>Offset</template>
						</GsSelect>
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
					<GsLiteralParameterValueControl
						v-else-if="paramValue.inputSource === 'literal'"
						ref="controlComponent"
						:def="paramDef"
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
	<div v-if="paramDef.dataType === 'array'" :key="arrayVersion" :class="$style.children">
		<GsVisualParam
			v-for="(value, index) in arrayValues"
			:key="index"
			:automationGraphs="automationGraphs"
			:availableVariables="availableVariables"
			:visualModuleId="visualModuleId"
			:node="node"
			:paramPath="[...paramPath, index]"
			:paramDef="paramDef.item"
			:paramValue="value"
			:label="'[' + index + ']'"
			@edit="emit('edit', $event)"
		>
			<template #actions>
				<GsButton small iconOnly danger title="Remove element" @click="removeElement(index)"><i class="ti ti-x"></i></GsButton>
			</template>
		</GsVisualParam>
	</div>
	<div v-else-if="paramDef.dataType === 'struct' && structValues" :class="$style.children">
		<GsVisualParam
			v-for="[key, def] in visibleFields"
			:key="key"
			:automationGraphs="automationGraphs"
			:availableVariables="availableVariables"
			:visualModuleId="visualModuleId"
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
import { deepClone } from '@glitch/shared/utility/deep-clone.js';
import type { ParameterDefinition } from '@glitch/shared/parameter.js';

export type ParamEdit = { paramPath: ParamPath; mergeKey?: string | null } & (
	| { kind: 'literal'; value: any }
	| { kind: 'automationGraphInline'; value: Extract<ParameterBinding, { inputSource: 'automationGraphInline' }> }
	| { kind: 'envVariable'; value: GlobalEnvVariable }
	| { kind: 'expression'; value: string }
	| { kind: 'automationGraphReference'; value: string | null; options?: Partial<AutomationGraphPlaybackOptions> }
	| { kind: 'node'; value: NodeOutputReference | null; preserveSampling: boolean }
	| { kind: 'externalCustomParameterInput'; value: VisualModuleCustomParameterId }
	| { kind: 'inputSource'; inputSource: ParameterBinding['inputSource'] }
	| { kind: 'reset' }
	| { kind: 'addElement' }
	| { kind: 'removeElement'; index: number }
);
</script>

<script lang="ts" setup>
import { visualModuleCustomParameterId } from '@glitch/shared/visual-module/types.ts';
import { computed, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch, watchEffect } from 'vue';
import { genId } from '@glitch/shared/utility/id.ts';
import { getNodeInputDataType } from '@glitch/shared/utility/node-outputs.ts';
import * as AiScript from '@syuilo/aiscript';
import GsNodePort from './GsNodePort.vue';
import GsLiteralParameterValueControl from './GsLiteralParameterValueControl.vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsCondensedLine from './common/GsCondensedLine.vue';
import GsSelect from './common/GsSelect.vue';
import GsAutomationGraphPointsEditorWindow from './GsAutomationGraphPointsEditorWindow.vue';
import type { Ref } from 'vue';
import type { NodeOutputReference, VisualModule, VisualModuleCustomParameterId, VisualModuleEffectNode } from '@glitch/shared/visual-module/types.ts';
import type { GlobalEnvVariable } from '@glitch/shared/expression.ts';
import type { ParamPath } from '@/utility/node-params.ts';
import type { AutomationGraphPlaybackOptions, GsAutomationGraph, GsBezierAnchorPoint, ParameterBinding } from '@glitch/shared/types.ts';
import type { MenuItem } from '@/types/menu.ts';
import { i18n } from '@/i18n.ts';
import { appContext, wireMap } from '@/app.ts';
import { paramPathKey } from '@/utility/node-params.ts';
import { getNodeOutputItems, hasNodeInputTypeMismatch, nodeOutputKey } from '@/utility/node-outputs.ts';
import { registerWireInput } from '@/utility/wire-drag.ts';
import { getNodeInputSamplingMenuItems } from '@/utility/input-sampling-menu.ts';
import * as ui from '@/ui.ts';
import { setInlineAutomationGraphNormalized } from '@/utility/automation-graph.ts';

const props = defineProps<{
	automationGraphs: readonly GsAutomationGraph[];
	availableVariables: readonly Exclude<GlobalEnvVariable, ''>[];
	visualModuleId?: string;
	node?: VisualModuleEffectNode;
	paramPath: ParamPath;
	paramDef: ParameterDefinition;
	paramValue: ParameterBinding;
	label?: string;
}>();

const emit = defineEmits<{ edit: [event: ParamEdit] }>();

const rowEl = useTemplateRef('rowEl');
const portEl = shallowRef<HTMLElement | null>(null);
const arrayValues = computed<ParameterBinding[]>(() => props.paramDef.dataType === 'array' && props.paramValue.inputSource === 'literal' ? props.paramValue.value : []);
const structValues = computed<Record<string, ParameterBinding> | null>(() => props.paramDef.dataType === 'struct' && props.paramValue.inputSource === 'literal' ? props.paramValue.value : null);
const visibleFields = computed(() => {
	if (props.paramDef.dataType !== 'struct') return [];
	const fields: Record<string, ParameterDefinition> = props.paramDef.fields;
	return Object.entries(fields);
});
const canNode = computed(() => props.paramDef.canNode);
const inputDataType = computed(() => getNodeInputDataType(props.paramDef));
const paramDefs = computed(() => appContext.state.visualModules.value.find(module => module.id === props.visualModuleId)?.paramDefs ?? []);
const nodes = computed(() => appContext.state.visualModules.value.find(visualModule => visualModule.id === props.visualModuleId)?.nodes ?? []);

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
const externalCustomParameterInputItems = computed(() => (props.node == null ? [] : appContext.state.visualModules.value.find(module => module.id === props.visualModuleId)?.paramDefs ?? [])
	.map(def => ({ label: `${def.ui.label} (${def.nameForReference})`, value: def.id })));
const nodeOutputItems = computed(() => props.node == null ? [] : getNodeOutputItems(nodes.value, props.node.id, inputDataType.value, paramDefs.value));
const nodeConnection = computed<NodeOutputReference | null>(() => props.paramValue.inputSource === 'node' && props.paramValue.nodeId != null ? props.paramValue : null);
const controlComponent = useTemplateRef('controlComponent');
const inlineGraphEditorOpen = ref(false);

let commandMergeKey: string | null = null;
let mounted = true;
onBeforeUnmount(() => { mounted = false; });
const arrayVersion = ref(0);
// 要素の増減時だけ子を作り直す。値の編集・Undoによる配列置換では開いたエディタを維持する。
watch(() => arrayValues.value.length, () => {
	arrayVersion.value++;
});
watch(() => JSON.stringify([props.visualModuleId, props.node?.id, props.paramPath, props.paramValue.inputSource]), () => {
	commandMergeKey = null;
	inlineGraphEditorOpen.value = false;
});

function target() {
	return { paramPath: props.paramPath };
}

watchEffect(onCleanup => {
	const row = rowEl.value;
	if (!row || !canNode.value) return;
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

function updateInlineGraphPoints(points: GsBezierAnchorPoint[], mergeKey: string | null) {
	if (!mounted || props.paramValue.inputSource !== 'automationGraphInline') return;
	emit('edit', {
		kind: 'automationGraphInline', ...target(), mergeKey,
		value: { ...deepClone(props.paramValue), automationGraph: { ...props.paramValue.automationGraph, points: deepClone(points) } },
	});
}

function updateAutomationGraphDuration(durationMs: number) {
	if (Number.isFinite(durationMs) && durationMs > 0) updateAutomationGraphOptions({ durationMs });
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
	if (props.paramDef.dataType !== 'array' && props.paramDef.dataType !== 'struct') {
		menuItems.push({ type: 'label', text: 'Input source' });
		const types: { text: string; inputSource: ParameterBinding['inputSource']; icon: string }[] = [
			{ text: 'Literal', inputSource: 'literal', icon: 'ti ti-adjustments-horizontal' },
			{ text: 'Automation Graph (Reference)', inputSource: 'automationGraphReference', icon: 'ti ti-ease-in-out-control-points' },
			{ text: 'Automation Graph (Inline)', inputSource: 'automationGraphInline', icon: 'ti ti-ease-in-out-control-points' },
			{ text: 'Environment Variable', inputSource: 'envVariable', icon: 'ti ti-variable' },
			{ text: 'Expression', inputSource: 'expression', icon: 'ti ti-math-function' },
		];
		if (props.node != null) types.push({ text: 'Custom Parameter', inputSource: 'externalCustomParameterInput', icon: 'ti ti-wifi' });
		if (canNode.value) types.push({ text: 'Node', inputSource: 'node', icon: 'ti ti-plug' });
		for (const { text, inputSource, icon } of types) {
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
	const menuItems: MenuItem[] = [{
		text: 'Disconnect',
		danger: true,
		action: () => connectNode(null),
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

	ui.popupMenu(menuItems, ev.currentTarget ?? ev.target);
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

function removeElement(index: number) {
	emit('edit', { kind: 'removeElement', ...target(), index });
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
	padding: 3px 16px;
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
