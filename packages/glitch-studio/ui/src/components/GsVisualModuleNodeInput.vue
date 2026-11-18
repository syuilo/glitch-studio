<template>
<div ref="inputRow" :class="$style.inputRow" data-wire-input-row>
	<GsNodePort :dataType="dataType" @update:element="inputPortEl = $event"/>
	<span>{{ label }}</span>
	<i v-if="hasNodeInputTypeMismatch(nodes, connection, dataType, paramDefs, effectDefinitions)" v-tooltip="i18n.ts._Node.TypeMismatch" class="ti ti-alert-triangle" :class="$style.typeWarning"></i>
	<GsSelect
		:modelValue="nodeOutputKey(connection)"
		:items="[{ label: i18n.ts.None, value: null }, ...outputItems]"
		@update:modelValue="selectInput"
	/>
</div>
</template>

<script lang="ts" setup>
import { useProjectSession } from '@/project-session.ts';
import { getEffectDefinitions } from '@/utility/project-effects.ts';
import { computed, shallowRef, useTemplateRef, watchEffect } from 'vue';
import GsNodePort from './GsNodePort.vue';
import GsSelect from './common/GsSelect.vue';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { VisualModule, NodeOutputReference } from '@gs/subsystems_visual-module_shared/types.ts';
import { useVisualModuleWires } from '@/utility/visual-module-wires.ts';
import { i18n } from '@/i18n.ts';
import { getNodeOutputItems, hasNodeInputTypeMismatch, nodeOutputKey } from '@/utility/node-outputs.ts';
import { registerWireInput } from '@/utility/wire-drag.ts';

const projectSession = useProjectSession();

const effectDefinitions = computed(() => getEffectDefinitions(projectSession.projectContext.stateManager.state));

const wireMap = useVisualModuleWires();

const props = defineProps<{
	visualModule: VisualModule;
	nodeId: string;
	inputId: string;
	label: string;
	dataType: TextureDataType;
	input: { nodeId: string; outputPort: string } | { nodeId: null; outputPort: null } | null;
}>();

const emit = defineEmits<{ change: [value: NodeOutputReference | null] }>();

const inputPortEl = shallowRef<HTMLElement | null>(null);
const inputRow = useTemplateRef('inputRow');
const paramDefs = computed(() => props.visualModule.paramDefs);
const nodes = computed(() => props.visualModule.nodes);
const connection = computed(() => props.input?.nodeId == null ? null : props.input);
const outputItems = computed(() => getNodeOutputItems(nodes.value, props.nodeId, props.dataType, paramDefs.value, effectDefinitions.value));

function connect(value: NodeOutputReference | null) {
	if (value != null && !outputItems.value.some(item => item.value === nodeOutputKey(value))) return;
	emit('change', value);
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
	const { nodeId, inputId } = props;
	if (el == null) return;
	wireMap.in[nodeId] ??= {};
	wireMap.in[nodeId][inputId] = el;
	onCleanup(() => {
		if (wireMap.in[nodeId]?.[inputId] === el) delete wireMap.in[nodeId][inputId];
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
