<template>
<div :class="[$style.root]">
	<div :class="[$style.header]">
		<div :class="$style.headerLeft">
			<b><i class="ti ti-arrow-right"></i> Out</b>
		</div>
	</div>

	<div ref="inputRow" :class="$style.inputRow" data-wire-input-row>
		<GsNodePort dataType="color" @update:element="allInPortEl = $event"/>
		<i v-if="hasNodeInputTypeMismatch(nodes, connection, 'color')" v-tooltip="'Data type mismatch'" class="ti ti-alert-triangle" :class="$style.typeWarning"></i>
		<GsSelect
			small
			:modelValue="nodeOutputKey(connection)"
			:items="[{ label: i18n.ts.None, value: null }, ...outputItems]"
			@update:modelValue="selectInput"
		/>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, shallowRef, useTemplateRef, watchEffect } from 'vue';
import GsNodePort from './GsNodePort.vue';
import GsSelect from './common/GsSelect.vue';
import type { GsGlobalOutNode, NodeOutputReference } from '@glitch/shared/types.ts';
import { appContext, wireMap } from '@/app.ts';
import { i18n } from '@/i18n.ts';
import { getNodeOutputItems, hasNodeInputTypeMismatch, nodeOutputKey } from '@/utility/node-outputs.ts';
import { registerWireInput } from '@/utility/wire-drag.ts';

const props = defineProps<{
	nodeGraphId: string;
	node: GsGlobalOutNode;
}>();

const allInPortEl = shallowRef<HTMLElement | null>(null);
const inputRow = useTemplateRef('inputRow');
const nodes = computed(() => appContext.state.nodeGraphs.value.find(graph => graph.id === props.nodeGraphId)?.nodes ?? []);
const connection = computed(() => props.node.input.nodeId == null ? null : props.node.input);
const outputItems = computed(() => getNodeOutputItems(nodes.value, props.node.id, 'color'));

function connect(value: NodeOutputReference | null) {
	if (value != null && !outputItems.value.some(item => item.value === nodeOutputKey(value))) return;
	appContext.commit('updateGlobalOutInput', { nodeGraphId: props.nodeGraphId, nodeId: props.node.id, value });
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
	const el = allInPortEl.value;
	const nodeId = props.node.id;
	if (el == null) return;
	wireMap.allIn[nodeId] = el;
	onCleanup(() => {
		if (wireMap.allIn[nodeId] === el) delete wireMap.allIn[nodeId];
	});
});
</script>

<style module lang="scss">
.root {
	position: relative;
	background: var(--THEME-nodeBg);
	border-radius: 6px;
	overflow: clip;
	contain: content;
}

.inputRow {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 16px;
}

.typeWarning {
	color: var(--THEME-warn);
}

.header {
	display: flex;
	white-space: nowrap;
	overflow: clip;
	height: 32px;
	text-overflow: ellipsis;
	font-size: 95%;
	cursor: move;
	background: linear-gradient(0deg, var(--THEME-nodeBg), hsl(from var(--THEME-nodeBg) h s calc(l + 5)));
	//background: var(--THEME-nodeBg);

	&.disabled {
		pointer-events: none;
	}
}

.headerLeft {
	display: flex;
	margin-right: auto;
	padding-left: 8px;
	align-items: center;
	gap: 8px;
}

.headerRight {
	display: flex;
	margin-left: auto;
	align-items: center;
	gap: 8px;
}

.nodeId {
}

.headerButtons {
}

.headerButton {
	display: inline-block;
	width: 23px;
	height: 23px;
	font-size: 90%;
	padding-left: 0;
	padding-right: 0;

	&:not(:first-child) {
		margin-left: 6px;
	}
}
</style>
