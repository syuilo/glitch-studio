<template>
<div :class="$style.root">
	<div ref="rowEl" :class="$style.row" data-wire-input-row>
		<div :class="[$style.paramLabel, { [$style.expression]: scalarValue?.type === 'expression' }]" @click="showMenu">
			<GsCondensedLine>{{ label ?? paramDef.label }}</GsCondensedLine>
		</div>
		<div :class="$style.paramBody">
			<template v-if="paramDef.array">
				<span :class="$style.count">{{ arrayValues.length }}</span>
				<GsButton small iconOnly title="Add element" @click="addElement"><i class="ti ti-plus"></i></GsButton>
			</template>
			<template v-else-if="paramDef.type !== 'struct' && scalarValue">
				<GsNodePort v-if="canNode" :dataType="inputDataType" @update:element="portEl = $event"/>
				<i v-if="hasNodeInputTypeMismatch(appContext.state.nodes.value, nodeConnection, inputDataType)" v-tooltip="'Data type mismatch'" class="ti ti-alert-triangle" :class="$style.typeWarning"></i>
				<div :class="$style.control">
					<GsInput v-if="scalarValue.type === 'expression'" type="text" :modelValue="scalarValue.expression" @update:modelValue="updateParamAsExpression">
						<template #caption>
							<div v-if="isExpressionSyntaxError" style="color: var(--THEME-error);"><i class="ti ti-alert-triangle"></i> Syntax error!</div>
						</template>
					</GsInput>
					<GsButton v-else-if="scalarValue.type === 'automation'" small @click="selectAutomation">{{ automationName }}</GsButton>
					<GsSelect
						v-else-if="scalarValue.type === 'node'"
						small
						:modelValue="nodeOutputKey(nodeConnection)"
						:items="[{ label: i18n.ts.None, value: null }, ...nodeOutputItems]"
						@update:modelValue="updateParamAsNode"
					/>
					<GsEffectParamControl
						v-else
						:type="paramDef.type"
						:title="label ?? paramDef.label"
						:options="paramDef"
						:value="scalarValue.value"
						@input="updateParamAsLiteral"
						@beginChanging="onBeginChanging"
						@changeContinuous="changeContinuous"
						@changeFinished="onFinishChanging"
					/>
				</div>
			</template>
			<slot name="actions"></slot>
		</div>
	</div>
	<div v-if="paramDef.array" :key="arrayVersion" :class="$style.children">
		<GsEffectNodeParam
			v-for="(value, index) in arrayValues"
			:key="index"
			:node="node"
			:paramPath="[...paramPath, index]"
			:paramDef="getArrayElementDef(paramDef, index)"
			:paramValue="value"
			:label="'[' + index + ']'"
		>
			<template #actions>
				<GsButton small iconOnly title="Remove element" @click="removeElement(index)"><i class="ti ti-x"></i></GsButton>
			</template>
		</GsEffectNodeParam>
	</div>
	<div v-else-if="paramDef.type === 'struct' && structValues" :class="$style.children">
		<GsEffectNodeParam
			v-for="[key, def] in visibleFields"
			:key="key"
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
import type { NodeParamDef, NodeParamValue, ParamPath } from '@/utility/node-params.ts';
import { i18n } from '@/i18n.ts';
import { appContext, wireMap } from '@/app.ts';
import { getArrayElementDef, paramPathKey } from '@/utility/node-params.ts';
import { getNodeOutputItems, hasNodeInputTypeMismatch, nodeOutputKey } from '@/utility/node-outputs.ts';
import { registerWireInput } from '@/utility/wire-drag.ts';
import * as ui from '@/ui.ts';

const props = defineProps<{
	node: GsEffectNode;
	paramPath: ParamPath;
	paramDef: NodeParamDef;
	paramValue: NodeParamValue;
	label?: string;
}>();

const rowEl = useTemplateRef('rowEl');
const portEl = shallowRef<HTMLElement | null>(null);
const scalarValue = computed(() => Array.isArray(props.paramValue) ? null : props.paramValue);
const arrayValues = computed(() => Array.isArray(props.paramValue) ? props.paramValue : []);
const structValues = computed<Record<string, NodeParamValue> | null>(() => props.paramDef.type === 'struct' && scalarValue.value?.type === 'literal' ? scalarValue.value.value : null);
const visibleFields = computed(() => {
	if (props.paramDef.type !== 'struct') return [];
	const fields: Record<string, NodeParamDef> = props.paramDef.fields;
	return Object.entries(fields).filter(([, def]) => !def.visibility || def.visibility(structValues.value ?? {}));
});
const canNode = computed(() => !props.paramDef.array && props.paramDef.type !== 'struct' && props.paramDef.canNode);
const inputDataType = computed(() => !props.paramDef.array && props.paramDef.type !== 'struct' ? getNodeInputDataType(props.paramDef) : null);
const nodeOutputItems = computed(() => getNodeOutputItems(appContext.state.nodes.value, props.node.id, inputDataType.value));
const nodeConnection = computed<NodeOutputReference | null>(() => scalarValue.value?.type === 'node' && scalarValue.value.nodeId != null ? scalarValue.value : null);
const automationName = computed(() => {
	const value = scalarValue.value;
	return value?.type === 'automation' ? appContext.state.automations.value.find(a => a.id === value.automationId)?.name ?? '(none)' : '(none)';
});

let commandMergeKey: string | null = null;
let mounted = true;
onBeforeUnmount(() => { mounted = false; });
const arrayVersion = ref(0);
// 構造変更時は子を作り直し、同じindexになった別要素へ編集中の状態を引き継がない。
watch(() => props.paramValue, () => {
	if (props.paramDef.array) arrayVersion.value++;
});
watch(() => JSON.stringify([props.node.id, props.paramPath]), () => { commandMergeKey = null; });

function target() {
	return { nodeId: props.node.id, paramPath: props.paramPath };
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
	if (scalarValue.value?.type !== 'expression') return false;
	try {
		aisParser.parse(scalarValue.value.expression);
		return false;
	} catch {
		return true;
	}
});

// ポップアップ表示中に配列要素が消えた場合、古いメニューから別要素を変更しない。
function menuAction(action: () => void) {
	const nodeId = props.node.id;
	const key = paramPathKey(props.paramPath);
	return () => {
		if (mounted && props.node.id === nodeId && paramPathKey(props.paramPath) === key) action();
	};
}

function selectAutomation(ev: PointerEvent) {
	ui.popupMenu([
		{ text: '(none)', action: menuAction(() => appContext.commit('updateParamAsAutomation', { ...target(), value: null })) },
		...appContext.state.automations.value.map(a => ({
			text: a.name,
			action: menuAction(() => appContext.commit('updateParamAsAutomation', { ...target(), value: a.id })),
		})),
	], ev.currentTarget ?? ev.target);
}

function showMenu(ev: PointerEvent) {
	const menuItems: MenuItem[] = [{
		text: 'Reset',
		danger: true,
		action: menuAction(() => appContext.commit('resetNodeParam', target())),
	}];
	// コンテナ自体は静的な構造を維持し、値の種類を変更できるのは末端だけにする。
	if (!props.paramDef.array && props.paramDef.type !== 'struct') {
		menuItems.push({ type: 'label', text: 'Type' });
		const types: { text: string; type: EffectParamValue['type'] }[] = [
			{ text: 'Literal', type: 'literal' },
			{ text: 'Automation', type: 'automation' },
			{ text: 'Expression', type: 'expression' },
		];
		if (canNode.value) types.push({ text: 'Node', type: 'node' });
		for (const { text, type } of types) {
			menuItems.push({ text, active: scalarValue.value?.type === type, action: menuAction(() => appContext.commit('changeParamValueType', { ...target(), type })) });
		}
	}
	ui.popupMenu(menuItems, ev.currentTarget ?? ev.target);
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
	}
}

.paramLabel {
	place-content: center left;
	width: 35%;
	box-sizing: border-box;
	padding-right: 12px;
	flex-shrink: 0;
	white-space: nowrap;
	text-overflow: ellipsis;
	overflow: clip;
	font-size: 95%;
	cursor: pointer;

	&.expression {
		color: var(--THEME-expression);
	}
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
}

.count {
	opacity: 0.6;
}

.typeWarning {
	color: var(--THEME-warn);
}
</style>
