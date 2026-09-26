<template>
<div ref="inputRow" :class="$style.inputRow" data-wire-input-row>
	<GsNodePort :dataType="def.dataType" @update:element="inputPortEl = $event"/>
	<span>{{ def.label }}</span>
	<i v-if="hasNodeInputTypeMismatch(nodes, connection, def.dataType, paramDefs)" v-tooltip="'Data type mismatch'" class="ti ti-alert-triangle" :class="$style.typeWarning"></i>
	<GsSelect
		small
		:modelValue="nodeOutputKey(connection)"
		:items="[{ label: i18n.ts.None, value: null }, ...outputItems]"
		@update:modelValue="selectInput"
	/>
</div>
</template>

<script lang="ts" setup>
import { computed, shallowRef, useTemplateRef, watchEffect } from 'vue';
import GsNodePort from './GsNodePort.vue';
import GsSelect from './common/GsSelect.vue';
import type { VisualModuleGlobalOutNode, VisualModule, NodeOutputReference } from '@glitch/shared/visual-module/types.js';
import { appStateManager, wireMap } from '@/app.ts';
import { i18n } from '@/i18n.ts';
import { getNodeOutputItems, hasNodeInputTypeMismatch, nodeOutputKey } from '@/utility/node-outputs.ts';
import { registerWireInput } from '@/utility/wire-drag.ts';

const props = defineProps<{
	visualModuleId: string;
	node: VisualModuleGlobalOutNode;
	def: VisualModule['outputDefs'][number];
}>();

const inputPortEl = shallowRef<HTMLElement | null>(null);
const inputRow = useTemplateRef('inputRow');
const paramDefs = computed(() => appStateManager.state.visualModules.value.find(module => module.id === props.visualModuleId)?.paramDefs ?? []);
const nodes = computed(() => appStateManager.state.visualModules.value.find(visualModule => visualModule.id === props.visualModuleId)?.nodes ?? []);
const connection = computed(() => {
	const input = props.node.inputs[props.def.id];
	return input?.nodeId == null ? null : input;
});
const outputItems = computed(() => getNodeOutputItems(nodes.value, props.node.id, props.def.dataType, paramDefs.value));

function connect(value: NodeOutputReference | null) {
	if (value != null && !outputItems.value.some(item => item.value === nodeOutputKey(value))) return;
	appStateManager.commit('updateGlobalOutInput', { visualModuleId: props.visualModuleId, nodeId: props.node.id, outputId: props.def.id, value });
}

function selectInput(key: string | null) {
	if (key == null) connect(null);
	else {
		const item = outputItems.value.find(item => item.value === key);
		if (item) connect(item.connection);
	}
}

watchEffect(onCleanup => {
	const row = inputRow.value;
	if (!row) return;
	onCleanup(registerWireInput(row, connect,
		value => outputItems.value.find(item => item.value === nodeOutputKey(value))?.typeCompatible ?? null));
});

watchEffect(onCleanup => {
	const el = inputPortEl.value;
	const nodeId = props.node.id;
	const outputId = props.def.id;
	if (el == null) return;
	wireMap.in[nodeId] ??= {};
	wireMap.in[nodeId][outputId] = el;
	onCleanup(() => {
		if (wireMap.in[nodeId]?.[outputId] === el) delete wireMap.in[nodeId][outputId];
	});
});
</script>

<style module lang="scss">
.inputRow {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 2px 8px;
}

.typeWarning {
	color: var(--THEME-warn);
}
</style>
