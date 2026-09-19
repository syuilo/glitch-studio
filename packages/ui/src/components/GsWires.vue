<template>
<!-- 測定要素の包含ブロックは、ポートも含むnodesContentに揃える。 -->
<div
	v-for="port in measuredPorts"
	:key="port.anchorName"
	:ref="el => setMeasureElement(port.element, el)"
	:class="$style.portMeasure"
	:style="{
		right: `anchor(${port.anchorName} center, 100%)`,
		bottom: `anchor(${port.anchorName} center, 100%)`,
	}"
></div>
<div ref="rootEl" :class="$style.root">
	<svg v-for="(wire, index) in wires" :key="wire.key" version="1.1" :viewBox="`0 0 ${width} ${height}`" :class="$style.wire">
		<defs>
			<linearGradient :id="`${gradientId}-${index}-color`" gradientUnits="userSpaceOnUse" :gradientTransform="getGradientTransform(wire)" x1="0" y1="0" x2="1" y2="0">
				<stop offset="0" :stop-color="wire.fromColor"/>
				<stop offset="1" :stop-color="wire.toColor"/>
			</linearGradient>
			<linearGradient :id="`${gradientId}-${index}`" gradientUnits="userSpaceOnUse" :gradientTransform="getGradientTransform(wire)" x1="0" y1="0" :x2="gradientPeriod" y2="0" spreadMethod="repeat">
				<stop offset="0" stop-color="white" stop-opacity="0"/>
				<stop offset="0.25" stop-color="white" stop-opacity="0"/>
				<stop offset="0.5" stop-color="white" stop-opacity="0.9"/>
				<stop offset="0.75" stop-color="white" stop-opacity="0"/>
				<stop offset="1" stop-color="white" stop-opacity="0"/>
				<animate attributeName="x1" from="0" :to="gradientPeriod" :dur="gradientAnimationDuration" repeatCount="indefinite"/>
				<animate attributeName="x2" :from="gradientPeriod" :to="gradientPeriod * 2" :dur="gradientAnimationDuration" repeatCount="indefinite"/>
			</linearGradient>
			<mask :id="`${gradientId}-${index}-pulse`" maskUnits="userSpaceOnUse" x="0" y="0" :width="width" :height="height">
				<line :x1="wire.from[0]" :y1="wire.from[1]" :x2="wire.to[0]" :y2="wire.to[1]" :stroke="`url(#${gradientId}-${index})`" stroke-width="3"/>
			</mask>
		</defs>
		<line :x1="wire.from[0]" :y1="wire.from[1]" :x2="wire.to[0]" :y2="wire.to[1]" :stroke="`url(#${gradientId}-${index}-color)`" stroke-width="3" opacity="0.3"/>
		<line :x1="wire.from[0]" :y1="wire.from[1]" :x2="wire.to[0]" :y2="wire.to[1]" :stroke="`url(#${gradientId}-${index}-color)`" :mask="`url(#${gradientId}-${index}-pulse)`" stroke-width="3"/>
	</svg>
</div>
</template>

<script lang="ts" setup>
import { computed, onMounted, onBeforeUnmount, ref, shallowReactive, shallowRef, useId, useTemplateRef, watch } from 'vue';
import { getNodeInputDataType, getNodeOutputs } from '@glitch/shared/utility/node-outputs.ts';
import type { ComponentPublicInstance } from 'vue';
import type { NodeDataType } from '@glitch/shared/utility/node-outputs.ts';
import { appContext, wireMap } from '@/app.ts';
import { wireDrag } from '@/utility/wire-drag.ts';
import { getNodeDataTypeColor } from '@/utility/node-outputs.ts';
import { paramPathKey, walkNodeParams } from '@/utility/node-params.ts';

const props = defineProps<{ visualModuleId: string }>();

// 配線全長に含まれる模様の周期数（正の数）。
const gradientRepeatCount = 4;
// 光が配線全長を移動する秒数（正の数）。小さいほど速くなる。
const gradientTravelSeconds = 4;

const gradientPeriod = 1 / gradientRepeatCount;
// 1周期分だけ移動してループさせ、密度を変えても速度と継ぎ目を保つ。
const gradientAnimationDuration = `${gradientTravelSeconds * gradientPeriod}s`;

const rootEl = useTemplateRef('rootEl');
const gradientId = useId();
const width = ref(0);
const height = ref(0);

type Position = [number, number];
type Wire = {
	key: string;
	from: Position;
	to: Position;
	fromColor: string;
	toColor: string;
};

// 接続先の列挙はレイアウトから独立させ、座標変更では再走査しない。
const paramDefs = computed(() => appContext.state.visualModules.value.find(module => module.id === props.visualModuleId)?.paramDefs ?? []);
const outputDefs = computed(() => appContext.state.visualModules.value.find(module => module.id === props.visualModuleId)?.outputDefs ?? []);
const nodesById = computed(() => {
	const nodes = appContext.state.visualModules.value.find(visualModule => visualModule.id === props.visualModuleId)?.nodes ?? [];
	return new Map(nodes.map(node => [node.id, node]));
});

const connections = computed(() => {
	const result: {
		key: string;
		from: HTMLElement;
		input: HTMLElement | undefined;
		allIn: HTMLElement | undefined;
		fromColor: string;
		toColor: string;
	}[] = [];
	for (const node of nodesById.value.values()) {
		if (node.type === 'globalOut') {
			for (const def of outputDefs.value) {
				const connection = node.inputs[def.id];
				if (connection?.nodeId == null || !nodesById.value.has(connection.nodeId)) continue;
				const { nodeId, outputPort } = connection;
				const from = wireMap.out[nodeId]?.[outputPort];
				if (from) result.push({
					key: JSON.stringify([props.visualModuleId, node.id, def.id, nodeId, outputPort]),
					from,
					input: wireMap.in[node.id]?.[def.id],
					allIn: undefined,
					...getWireColors(getNodeOutputs(nodesById.value.get(nodeId), paramDefs.value)[outputPort]?.dataType ?? 'any', def.dataType),
				});
			}
			continue;
		}
		if (node.type !== 'effect') continue;
		for (const { path, def, value } of walkNodeParams(node)) {
			if (value.type !== 'node' || value.nodeId == null || def.type === 'struct' || def.type === 'array') continue;
			if (!nodesById.value.has(value.nodeId)) continue;
			const from = wireMap.out[value.nodeId]?.[value.outputPort];
			if (!from) continue;
			result.push({
				key: JSON.stringify([props.visualModuleId, node.id, path, value.nodeId, value.outputPort]),
				from,
				input: wireMap.in[node.id]?.[paramPathKey(path)],
				allIn: wireMap.allIn[node.id],
				...getWireColors(getNodeOutputs(nodesById.value.get(value.nodeId), paramDefs.value)[value.outputPort]?.dataType ?? 'any', getNodeInputDataType(def) ?? 'any'),
			});
		}
	}
	return result;
});

const dragSource = computed(() => {
	const source = wireDrag.value?.source;
	if (!source) return undefined;
	return [...nodesById.value.keys()].some(id => Object.values(wireMap.out[id] ?? {}).includes(source)) ? source : undefined;
});
const measuredPorts = computed(() => {
	const elements = new Set<HTMLElement>();
	for (const connection of connections.value) {
		elements.add(connection.from);
		if (connection.input) elements.add(connection.input);
		if (connection.allIn) elements.add(connection.allIn);
	}
	if (dragSource.value) elements.add(dragSource.value);
	return [...elements].map(element => ({ element, anchorName: element.dataset.wireAnchor! }));
});

const positions = shallowReactive(new Map<HTMLElement, Position>());
const measureElements = new Map<HTMLElement, HTMLElement>();
const measurePorts = new WeakMap<Element, HTMLElement>();
const dragPosition = shallowRef<Position | null>(null);

const ro = new ResizeObserver(entries => {
	for (const entry of entries) {
		const { width: x, height: y } = entry.contentRect;
		if (entry.target === rootEl.value) {
			width.value = x;
			height.value = y;
			continue;
		}
		const port = measurePorts.get(entry.target);
		if (!port) continue;
		// 非表示・未解決のアンカーはCSSのfallbackで0×0になる。
		// nodesContentのpaddingにより、表示中のポート中心は常に正の座標を持つ。
		if (x === 0 || y === 0) {
			positions.delete(port);
		} else {
			const previous = positions.get(port);
			if (previous?.[0] !== x || previous[1] !== y) positions.set(port, [x, y]);
		}
	}
	updateDragPosition();
});

function setMeasureElement(port: HTMLElement, element: Element | ComponentPublicInstance | null) {
	const previous = measureElements.get(port);
	if (previous === element) return;
	if (previous) {
		ro.unobserve(previous);
		measurePorts.delete(previous);
		measureElements.delete(port);
		positions.delete(port);
	}
	if (!(element instanceof HTMLElement)) return;
	measureElements.set(port, element);
	measurePorts.set(element, port);
	ro.observe(element);
}

const wires = computed(() => {
	const result: Wire[] = [];
	for (const connection of connections.value) {
		const from = positions.get(connection.from);
		const to = (connection.input && positions.get(connection.input))
			?? (connection.allIn && positions.get(connection.allIn));
		if (!from || !to) continue;
		result.push({ key: connection.key, from, to, fromColor: connection.fromColor, toColor: connection.toColor });
	}
	const source = dragSource.value;
	const from = source && positions.get(source);
	if (source && from && dragPosition.value) {
		result.push({
			key: 'drag', from, to: dragPosition.value,
			...getWireColors((source.dataset.type as NodeDataType) ?? 'any', 'any'),
		});
	}
	return result;
});

function getWireColors(outputType: NodeDataType, inputType: NodeDataType) {
	// anyは相手側の型の色に揃え、両側がanyのときだけ中立色を使う。
	return {
		fromColor: getNodeDataTypeColor(outputType === 'any' ? inputType : outputType),
		toColor: getNodeDataTypeColor(inputType === 'any' ? outputType : inputType),
	};
}

function getGradientTransform(wire: typeof wires.value[number]): string {
	const dx = wire.to[0] - wire.from[0];
	const dy = wire.to[1] - wire.from[1];
	// 座標の1単位を配線全長に合わせ、模様の周期とは独立に移動速度を保つ。
	// 両端が重なる場合も変換行列が特異にならないようにする。
	const x = dx === 0 && dy === 0 ? 1 : dx;
	return `matrix(${x} ${dy} ${-dy} ${x} ${wire.from[0]} ${wire.from[1]})`;
}

function updateDragPosition() {
	const drag = wireDrag.value;
	if (!drag || !dragSource.value || !rootEl.value) {
		dragPosition.value = null;
		return;
	}
	// ポインターだけはviewport座標なので、ドラッグ中のイベント時に変換する。
	const rect = rootEl.value.getBoundingClientRect();
	const x = drag.clientX - rect.left;
	const y = drag.clientY - rect.top;
	if (dragPosition.value?.[0] !== x || dragPosition.value[1] !== y) dragPosition.value = [x, y];
}

watch([wireDrag, dragSource], updateDragPosition, { flush: 'post' });

onMounted(() => {
	if (rootEl.value) ro.observe(rootEl.value);
	// 通常の配線はスクロールで座標が変わらない。ドラッグ中の終点だけ更新する。
	window.addEventListener('scroll', updateDragPosition, { capture: true, passive: true });
	window.addEventListener('resize', updateDragPosition);
	updateDragPosition();
});
onBeforeUnmount(() => {
	ro.disconnect();
	measureElements.clear();
	positions.clear();
	window.removeEventListener('scroll', updateDragPosition, true);
	window.removeEventListener('resize', updateDragPosition);
});
</script>

<style module lang="scss">
.root {
	position: absolute;
	inset: 0;
	pointer-events: none;
}

.portMeasure {
	// 原点からポート中心までの矩形を作り、位置の変化をサイズの変化として監視する。
	position: absolute;
	top: 0;
	left: 0;
	visibility: hidden;
	pointer-events: none;
}

.wire {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
}
</style>
