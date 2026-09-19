<template>
<div :class="$style.root">
	<div ref="rowEl" :class="$style.row" data-wire-input-row @contextmenu.prevent.stop="onRowContextmenu">
		<div :class="[$style.paramHeader, { [$style.expression]: paramValue.type === 'expression' }]">
			<button v-if="paramDef.type === 'array' || paramDef.type === 'struct'" class="_button"><i class="ti ti-chevron-down" style="vertical-align: middle;"></i></button>
			<div :class="$style.paramLabel" @click="showMenu">
				<GsCondensedLine>{{ label ?? paramDef.label }}</GsCondensedLine>
			</div>
		</div>
		<div :class="$style.paramBody">
			<template v-if="paramDef.type === 'array'">
				<span :class="$style.count">{{ arrayValues.length }}</span>
				<GsButton small iconOnly title="Add element" @click="addElement"><i class="ti ti-plus"></i></GsButton>
			</template>
			<template v-else-if="paramDef.type !== 'struct'">
				<GsNodePort v-if="canNode" :dataType="inputDataType" @update:element="portEl = $event"/>
				<i v-if="hasNodeInputTypeMismatch(nodes, nodeConnection, inputDataType)" v-tooltip="'Data type mismatch'" class="ti ti-alert-triangle" :class="$style.typeWarning"></i>
				<div :class="$style.control">
					<GsInput v-if="paramValue.type === 'expression'" type="text" :modelValue="paramValue.expression" @update:modelValue="updateParamAsExpression">
						<template #caption>
							<div v-if="isExpressionSyntaxError" style="color: var(--THEME-error);"><i class="ti ti-alert-triangle"></i> Syntax error!</div>
						</template>
					</GsInput>
					<GsButton v-else-if="paramValue.type === 'automation'" small @click="selectAutomation">{{ automationName }}</GsButton>
					<GsSelect
						v-else-if="paramValue.type === 'node'"
						small
						:modelValue="nodeOutputKey(nodeConnection)"
						:items="[{ label: i18n.ts.None, value: null }, ...nodeOutputItems]"
						@update:modelValue="updateParamAsNode"
					/>
					<GsEffectParamControl
						v-else
						ref="controlComponent"
						:type="paramDef.type"
						:title="label ?? paramDef.label"
						:options="paramDef"
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
			<button class="_button" :class="$style.menuButton" @click="showMenu"><i class="ti ti-dots"></i></button>
		</div>
	</div>
	<div v-if="paramDef.type === 'array'" :key="arrayVersion" :class="$style.children">
		<GsEffectNodeParam
			v-for="(value, index) in arrayValues"
			:key="index"
			:visualModuleId="visualModuleId"
			:node="node"
			:paramPath="[...paramPath, index]"
			:paramDef="paramDef.item"
			:paramValue="value"
			:label="'[' + index + ']'"
		>
			<template #actions>
				<GsButton small iconOnly danger title="Remove element" @click="removeElement(index)"><i class="ti ti-x"></i></GsButton>
			</template>
		</GsEffectNodeParam>
	</div>
	<div v-else-if="paramDef.type === 'struct' && structValues" :class="$style.children">
		<GsEffectNodeParam
			v-for="[key, def] in visibleFields"
			:key="key"
			:visualModuleId="visualModuleId"
			:node="node"
			:paramPath="[...paramPath, key]"
			:paramDef="def"
			:paramValue="structValues[key]"
		/>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch, watchEffect } from 'vue';
import { genId } from '@glitch/shared/utility/id.ts';
import { getNodeInputDataType } from '@glitch/shared/utility/node-outputs.ts';
import * as AiScript from '@syuilo/aiscript';
import GsNodePort from './GsNodePort.vue';
import GsEffectParamControl from './GsEffectParamControl.vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsCondensedLine from './common/GsCondensedLine.vue';
import GsSelect from './common/GsSelect.vue';
import type { EffectParamValue, GsEffectNode, NodeOutputReference } from '@glitch/shared/types.ts';
import type { MenuItem } from '@/types/menu.ts';
import type { NodeParamDef, ParamPath } from '@/utility/node-params.ts';
import { i18n } from '@/i18n.ts';
import { appContext, wireMap } from '@/app.ts';
import { paramPathKey } from '@/utility/node-params.ts';
import { getNodeOutputItems, hasNodeInputTypeMismatch, nodeOutputKey } from '@/utility/node-outputs.ts';
import { registerWireInput } from '@/utility/wire-drag.ts';
import * as ui from '@/ui.ts';

const props = defineProps<{
	visualModuleId: string;
	node: GsEffectNode;
	paramPath: ParamPath;
	paramDef: NodeParamDef;
	paramValue: EffectParamValue;
	label?: string;
}>();

const rowEl = useTemplateRef('rowEl');
const portEl = shallowRef<HTMLElement | null>(null);
const arrayValues = computed<EffectParamValue[]>(() => props.paramDef.type === 'array' && props.paramValue.type === 'literal' ? props.paramValue.value : []);
const structValues = computed<Record<string, EffectParamValue> | null>(() => props.paramDef.type === 'struct' && props.paramValue.type === 'literal' ? props.paramValue.value : null);
const visibleFields = computed(() => {
	if (props.paramDef.type !== 'struct') return [];
	const fields: Record<string, NodeParamDef> = props.paramDef.fields;
	return Object.entries(fields).filter(([, def]) => !def.visibility || def.visibility(structValues.value ?? {}));
});
const canNode = computed(() => props.paramDef.type !== 'array' && props.paramDef.type !== 'struct' && props.paramDef.canNode);
const inputDataType = computed(() => props.paramDef.type !== 'array' && props.paramDef.type !== 'struct' ? getNodeInputDataType(props.paramDef) : null);
const nodes = computed(() => appContext.state.visualModules.value.find(visualModule => visualModule.id === props.visualModuleId)?.nodes ?? []);
const nodeOutputItems = computed(() => getNodeOutputItems(nodes.value, props.node.id, inputDataType.value));
const nodeConnection = computed<NodeOutputReference | null>(() => props.paramValue.type === 'node' && props.paramValue.nodeId != null ? props.paramValue : null);
const automationName = computed(() => {
	const value = props.paramValue;
	return value?.type === 'automation' ? appContext.state.automations.value.find(a => a.id === value.automationId)?.name ?? '(none)' : '(none)';
});
const controlComponent = useTemplateRef('controlComponent');

let commandMergeKey: string | null = null;
let mounted = true;
onBeforeUnmount(() => { mounted = false; });
const arrayVersion = ref(0);
// 構造変更時は子を作り直し、同じindexになった別要素へ編集中の状態を引き継がない。
watch(() => props.paramValue, () => {
	if (props.paramDef.type === 'array') arrayVersion.value++;
});
watch(() => JSON.stringify([props.visualModuleId, props.node.id, props.paramPath]), () => { commandMergeKey = null; });

function target() {
	return { visualModuleId: props.visualModuleId, nodeId: props.node.id, paramPath: props.paramPath };
}

watchEffect(onCleanup => {
	const row = rowEl.value;
	if (!row || !canNode.value) return;
	onCleanup(registerWireInput(row, connectNode,
		connection => nodeOutputItems.value.find(item => item.value === nodeOutputKey(connection))?.typeCompatible ?? null));
});

watchEffect(onCleanup => {
	const el = portEl.value;
	const nodeId = props.node.id;
	const key = paramPathKey(props.paramPath);
	if (el == null || !canNode.value) return;
	wireMap.in[nodeId] ??= {};
	wireMap.in[nodeId][key] = el;
	onCleanup(() => {
		if (wireMap.in[nodeId]?.[key] === el) delete wireMap.in[nodeId][key];
	});
});

const aisParser = new AiScript.Parser();
const isExpressionSyntaxError = computed(() => {
	if (props.paramValue.type !== 'expression') return false;
	try {
		aisParser.parse(props.paramValue.expression);
		return false;
	} catch {
		return true;
	}
});

function selectAutomation(ev: PointerEvent) {
	ui.popupMenu([
		{ text: '(none)', action: () => appContext.commit('updateParamAsAutomation', { ...target(), value: null }) },
		...appContext.state.automations.value.map(a => ({
			text: a.name,
			action: () => appContext.commit('updateParamAsAutomation', { ...target(), value: a.id }),
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
		action: () => appContext.commit('resetNodeParam', target()),
	}];

	// コンテナ自体は静的な構造を維持し、値の種類を変更できるのは末端だけにする。
	if (props.paramDef.type !== 'array' && props.paramDef.type !== 'struct') {
		menuItems.push({ type: 'label', text: 'Type' });
		const types: { text: string; type: EffectParamValue['type']; icon: string }[] = [
			{ text: 'Literal', type: 'literal', icon: 'ti ti-adjustments-horizontal' },
			{ text: 'Macro', type: 'macro', icon: 'ti ti-star' }, // TODO: なんか良いアイコンを探す
			{ text: 'Automation', type: 'automation', icon: 'ti ti-timeline' },
			{ text: 'Expression', type: 'expression', icon: 'ti ti-math-function' },
		];
		if (canNode.value) types.push({ text: 'Node', type: 'node', icon: 'ti ti-plug' });
		for (const { text, type, icon } of types) {
			menuItems.push({
				text,
				icon,
				active: props.paramValue.type === type,
				action: () => appContext.commit('changeParamValueType', { ...target(), type }),
			});
		}
	}
	return menuItems;
}

function showMenu(ev: PointerEvent) {
	ui.popupMenu(getMenu(), ev.currentTarget ?? ev.target);
}

function onRowContextmenu(ev: PointerEvent) {
	ui.contextMenu(getMenu(), ev);
}

function onBeginChanging() {
	commandMergeKey = genId();
}

function changeContinuous(value: any) {
	if (mounted) appContext.commit('updateParamAsLiteral', { ...target(), value }, commandMergeKey);
}

function onFinishChanging() {
	commandMergeKey = null;
}

function updateParamAsLiteral(value: any) {
	if (mounted) appContext.commit('updateParamAsLiteral', { ...target(), value });
}

function updateParamAsExpression(value: string) {
	if (mounted) appContext.commit('updateParamAsExpression', { ...target(), value });
}

function connectNode(value: NodeOutputReference | null) {
	// 別のVisualModuleや、グラフ切り替え前の候補へ接続しない。
	if (value != null && !nodeOutputItems.value.some(item => item.value === nodeOutputKey(value))) return;
	if (mounted) appContext.commit('updateParamAsNode', { ...target(), value });
}

function updateParamAsNode(key: string | null) {
	connectNode(nodeOutputItems.value.find(item => item.value === key)?.connection ?? null);
}

function addElement() {
	appContext.commit('addArrayParamElement', target());
}

function removeElement(index: number) {
	appContext.commit('removeArrayParamElement', { ...target(), index });
}

function onReset() {
	appContext.commit('resetNodeParam', target());
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

	&.expression {
		color: var(--THEME-expression);
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
