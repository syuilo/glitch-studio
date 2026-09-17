<template>
<!-- TODO: 重いからなんとかする -->
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
import { onMounted, onUnmounted, ref, useId, useTemplateRef, watch } from 'vue';
import { getNodeInputDataType } from '@glitch/shared/utility/node-outputs.ts';
import type { NodeDataType } from '@glitch/shared/utility/node-outputs.ts';
import type { GsNode } from '@glitch/shared/types.ts';
import { appContext, wireMap } from '@/app.ts';
import { wireDrag } from '@/utility/wire-drag.ts';
import { getNodeDataTypeColor } from '@/utility/node-outputs.ts';
import { paramPathKey, walkNodeParams } from '@/utility/node-params.ts';

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

const ro = new ResizeObserver(() => {
	if (rootEl.value == null) return;
	width.value = rootEl.value.clientWidth;
	height.value = rootEl.value.clientHeight;
});

onMounted(() => {
	if (rootEl.value) ro.observe(rootEl.value);
});

const wires = ref<{
	key: string;
	from: [number, number];
	to: [number, number];
	fromColor: string;
	toColor: string;
}[]>([]);

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

function getElementPosition(el: HTMLElement): [number, number] {
	const rootElRect = rootEl.value!.getBoundingClientRect();
	const rect = el.getBoundingClientRect();
	return [
		rect.left - rootElRect.left + rect.width / 2,
		rect.top - rootElRect.top + rect.height / 2,
	];
}

function isHidden(el: HTMLElement) {
	return (el.offsetParent === null);
}

function draw() {
	try {
		wires.value = [];
		if (rootEl.value == null) return;
		const drag = wireDrag.value;
		if (drag && drag.source.isConnected && !isHidden(drag.source)) {
			const rect = rootEl.value.getBoundingClientRect();
			wires.value.push({
				key: 'drag',
				from: getElementPosition(drag.source),
				to: [drag.clientX - rect.left, drag.clientY - rect.top],
				...getWireColors((drag.source.dataset.type as NodeDataType) ?? 'any', 'any'),
			});
		}

		function scan(nodes: GsNode[]) {
			for (const node of nodes) {
				if (node.type === 'group') {
					scan(node.nodes);
				} else {
					for (const { path, def, value } of walkNodeParams(node)) {
						if (value.type !== 'node' || value.nodeId == null || def.type === 'struct' || def.type === 'array') continue;
						const from = wireMap.out[value.nodeId]?.[value.outputPort];
						const key = paramPathKey(path);
						const input = wireMap.in[node.id]?.[key];
						const to = input && !isHidden(input) ? input : wireMap.allIn[node.id];
						if (!from || !to || isHidden(from) || isHidden(to)) continue;
						wires.value.push({
							key: JSON.stringify([node.id, path, value.nodeId, value.outputPort]),
							from: getElementPosition(from),
							to: getElementPosition(to),
							...getWireColors((from.dataset.type as NodeDataType) ?? 'any', getNodeInputDataType(def) ?? 'any'),
						});
					}
				}
			}
		}

		scan(appContext.state.nodes.value);
	} catch (e) {
		console.error(e);
	}
}

watch(wireMap, () => {
	draw();
}, { deep: true, immediate: true });

watch(wireDrag, draw, { flush: 'sync' });

let drawInterval: ReturnType<typeof window.setInterval>;
onMounted(() => {
	drawInterval = window.setInterval(() => {
		draw();
	}, 10);
});
onUnmounted(() => {
	window.clearInterval(drawInterval);
	ro.disconnect();
});
</script>

<style module lang="scss">
.root {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
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
