<template>
<div :class="$style.footer">
	<code :class="$style.nodeId">{{ node.id }}</code>
	<div v-for="port in ports" :key="port" :class="$style.output">
		<span>{{ port }}</span>
		<div :ref="el => setPort(port, el)" :class="$style.point">・</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onUnmounted } from 'vue';
import { getNodeOutputs } from '@glitch/shared/utility/node-outputs.ts';
import type { ComponentPublicInstance } from 'vue';
import type { GsNode } from '@glitch/shared/types.ts';
import { wireMap } from '@/app.ts';

const props = defineProps<{ node: GsNode }>();
const ports = computed(() => Object.keys(getNodeOutputs(props.node)));
const elements = new Map<string, HTMLElement>();

function setPort(port: string, el: Element | ComponentPublicInstance | null) {
	if (el instanceof HTMLElement) {
		elements.set(port, el);
		wireMap.out[props.node.id] ??= {};
		wireMap.out[props.node.id][port] = el;
	} else {
		// グループ間の移動で作り直された、新しいコンポーネントの登録は消さない。
		if (wireMap.out[props.node.id]?.[port] === elements.get(port)) delete wireMap.out[props.node.id]?.[port];
		elements.delete(port);
	}
}

onUnmounted(() => {
	if (Object.keys(wireMap.out[props.node.id] ?? {}).length === 0) delete wireMap.out[props.node.id];
});
</script>

<style module lang="scss">
.footer {
	display: flex;
	flex-wrap: wrap;
	gap: 0 12px;
	margin-top: 4px;
	line-height: 24px;
	background-color: #2d2d2d;
	background-image: repeating-linear-gradient(45deg, transparent, transparent 6px, #222222 6px, #222222 12px);
}

.output {
	margin-left: auto;
	display: flex;
	min-width: 0;
	overflow-wrap: anywhere;
}

.point {
	width: 24px;
	flex-shrink: 0;
	text-align: center;
}

.nodeId {
	padding-left: 8px;
	opacity: 0.5;
}
</style>
