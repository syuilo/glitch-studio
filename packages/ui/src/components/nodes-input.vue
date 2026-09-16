<template>
<div class="_gaps_s">
	<Sortable v-model="value" class="nodes _gaps_s" itemKey="id" tag="div" handle=".drag-handle" :animation="150" :swapThreshold="0.5">
		<template #item="{element}">
			<div style="display: flex;">
				<div :ref="el => setPort(element.id, el)" class="port">・</div>
				<GsSelect
					:modelValue="nodeOutputKey(element.node)"
					:items="[{ label: i18n.ts.None, value: null }, ...items]"
					style="flex: 1;"
					@update:modelValue="key => element.node = items.find(item => item.value === key)?.connection ?? null"
				/>
				<GsButton style="margin-left: 4px;" @click="remove(element)"><i class="ti ti-x"></i></GsButton>
				<div class="drag-handle" style="margin-left: 4px;">
					<svg viewBox="0 0 16 16" version="1.1" class="grabber">
						<path fill="currentColor" d="M10 13a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm0-4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm-4 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm5-9a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM6 5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path>
					</svg>
				</div>
			</div>
		</template>
	</Sortable>
	<GsButton @click="add">+</GsButton>
</div>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, ref, watch, watchEffect } from 'vue';
import { genId } from '@glitch/shared/utility/id.ts';
import GsButton from './common/GsButton.vue';
import GsSelect from './common/GsSelect.vue';
import type { ComponentPublicInstance } from 'vue';
import type { GsGroupNode, GsNode, NodeOutputReference } from '@glitch/shared/types.ts';
import { i18n } from '@/i18n.ts';
import { appContext, wireMap } from '@/app.ts';
import { getNodeOutputItems, nodeOutputKey } from '@/utility/node-outputs.ts';
import { registerWireInput } from '@/utility/wire-drag.ts';

const Sortable = defineAsyncComponent(() => import('vuedraggable').then(x => x.default));

const props = defineProps<{
	modelValue: (NodeOutputReference | null)[];
	node: GsNode;
	group?: GsGroupNode | null;
	name?: string;
}>();

const emit = defineEmits<{
	(ev: 'update:modelValue', value: (NodeOutputReference | null)[]): void;
}>();

const items = computed(() => getNodeOutputItems(appContext.state.nodes.value, props.node.id));

const portEls = ref<Record<string, HTMLElement>>({});

const value = ref(props.modelValue.map(x => ({
	id: genId(),
	node: x,
})));

function setPort(id: string, el: Element | ComponentPublicInstance | null) {
	if (el instanceof HTMLElement) portEls.value[id] = el;
	else delete portEls.value[id];
}

watchEffect(onCleanup => {
	for (const item of value.value) {
		const el = portEls.value[item.id];
		if (el == null) continue;
		onCleanup(registerWireInput(el.parentElement ?? el, connection => {
			item.node = connection;
		}, connection => items.value.some(output => output.value === nodeOutputKey(connection))));
	}
});

watchEffect(onCleanup => {
	const name = props.name;
	if (name == null) return;
	wireMap.in[props.node.id] ??= {};
	const ports = value.value.map(item => portEls.value[item.id]);
	wireMap.in[props.node.id][name] = ports;
	onCleanup(() => { delete wireMap.in[props.node.id]?.[name]; });
});

watch(value, () => {
	emit('update:modelValue', value.value.map(x => x.node));
}, { deep: true });

function add() {
	value.value.push({
		id: genId(),
		node: null,
	});
}

function remove(element: { id: string; node: NodeOutputReference | null; }) {
	value.value.splice(value.value.findIndex(x => x.id === element.id), 1);
}
</script>

<style scoped lang="scss">
.grabber {
	display: block;
	padding: 4px 0px;
	box-sizing: border-box;
	height: var(--control-height);
	cursor: move;
	user-select: none;
	opacity: 0.5;
}
</style>
