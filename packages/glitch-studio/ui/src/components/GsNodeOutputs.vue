<template>
<div :class="$style.root">
	<div v-for="(output, port) in ports" :key="port" :class="$style.output" @pointerdown="startDrag($event, port)">
		<span v-if="outputResolutions" :class="$style.resolution">{{ outputResolutions[port] ? `${outputResolutions[port].width}px × ${outputResolutions[port].height}px` : '—' }}</span>
		<span style="flex: 1; text-align: right;">{{ node.type === 'globalIn' ? paramDefs?.find(def => def.id === port)?.ui.label ?? port : port }}</span>
		<span :class="$style.dataType" style="margin-right: 4px;" :style="{ color: getNodeDataTypeColor(output.dataType) }">{{ output.dataType.kind }}</span>
		<GsNodePort style="place-self: center;" output :dataType="output.dataType" @update:element="el => setPort(port, el)"/>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onUnmounted } from 'vue';
import { getNodeOutputs } from '@gs/subsystems_visual-module_shared/node-outputs.ts';
import GsNodePort from './GsNodePort.vue';
import type { EffectInstanceState } from '@gs/subsystems_effect_shared/effect-status.ts';
import type { VisualModuleNode, VisualModule } from '@gs/subsystems_visual-module_shared/types.ts';
import { useVisualModuleWires } from '@/utility/visual-module-wires.ts';
import { startWireDrag } from '@/utility/wire-drag.ts';
import { getNodeDataTypeColor } from '@/utility/node-outputs.ts';

const wireMap = useVisualModuleWires();

const props = defineProps<{
	node: VisualModuleNode;
	paramDefs?: VisualModule['paramDefs'];
	outputResolutions?: EffectInstanceState['outputs']
}>();

const ports = computed(() => getNodeOutputs(props.node, props.paramDefs));
const elements = new Map<string, HTMLElement>();
let cancelDrag: (() => void) | undefined;

function startDrag(event: PointerEvent, port: string) {
	const source = elements.get(port);
	if (!source) return;
	const cancel = startWireDrag(event, { nodeId: props.node.id, outputPort: port, fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' }, { source });
	if (cancel) cancelDrag = cancel;
}

function setPort(port: string, el: HTMLElement | null) {
	if (el != null) {
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
	cancelDrag?.();
	if (Object.keys(wireMap.out[props.node.id] ?? {}).length === 0) delete wireMap.out[props.node.id];
});
</script>

<style module lang="scss">
.root {
	line-height: 24px;
	background-color: #2d2d2d;
	background-image: repeating-linear-gradient(45deg, transparent, transparent 6px, #222222 6px, #222222 12px);
}

.output {
	cursor: crosshair;
	touch-action: none;
	user-select: none;
	display: flex;
	min-width: 0;
	overflow-wrap: anywhere;
	padding-right: 4px;
}

.dataType {
	margin-left: 6px;
	font-size: 0.85em;
	opacity: 0.6;
}

.resolution {
	margin-left: 6px;
	font-size: 0.85em;
	opacity: 0.7;
}

.nodeId {
	padding-left: 8px;
	opacity: 0.5;
}
</style>
