<template>
<div :class="$style.root">
	<div :class="$style.header">
		<button class="_button" style="padding: 4px 6px;"><i class="ti ti-chevron-down"></i> Graph: {{ nodeGraph?.name ?? '' }} [{{ nodeGraph?.id ?? '' }}]</button>
	</div>
	<div v-if="nodeGraph != null" :key="nodeGraph.id" :class="$style.nodesContainer">
		<div :class="$style.nodesContent">
			<GsDraggable

				:modelValue="nodeGraph.nodes.filter(node => node.type !== 'globalIn' && node.type !== 'globalOut')"
				direction="vertical"
				manualDragStart
				withGaps
				@update:modelValue="onSorted"
			>
				<template #header>
					<XGlobalInNode v-if="globalInNode != null" :node="globalInNode" :class="$style.node" style="margin-bottom: 4px;"/>
				</template>
				<template #default="{ item: node, dragStart }">
					<XEffectNode v-if="node.type === 'effect'" :nodeGraphId="nodeGraph.id" :node="node" :class="$style.node" @dragStart="dragStart"/>
				</template>
				<template #footer>
					<GsButton :class="$style.addButton" full style="margin-top: 4px;" @click="showAddNodeMenu(nodeGraph.id, $event)"><i class="ti ti-plus"></i> Add node...</GsButton>

					<XGlobalOutNode v-if="globalOutNode != null" :node="globalOutNode" :nodeGraphId="nodeGraph.id" :class="$style.node" style="margin-top: 8px;"/>
				</template>
			</GsDraggable>

			<GsWires :nodeGraphId="nodeGraph.id"/>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import GsWires from './GsWires.vue';
import GsButton from './common/GsButton.vue';
import GsDraggable from './common/GsDraggable.vue';
import XEffectNode from './GsEffectNode.vue';
import XGlobalInNode from './GsGlobalInNode.vue';
import XGlobalOutNode from './GsGlobalOutNode.vue';
import type { GsNode, NodeGraph } from '@glitch/shared/types.js';
import { showAddNodeMenu } from '@/app.ts';
import { appContext } from '@/app.ts';

const nodeGraph = ref<NodeGraph | null>();

watch(appContext.state.nodeGraphs, () => {
	if (appContext.state.nodeGraphs.value.length > 0) nodeGraph.value = appContext.state.nodeGraphs.value[0];
});

const globalInNode = computed(() => {
	return nodeGraph.value?.nodes.find(node => node.type === 'globalIn') ?? null;
});

const globalOutNode = computed(() => {
	return nodeGraph.value?.nodes.find(node => node.type === 'globalOut') ?? null;
});

function onSorted(nodes: GsNode[]) {
	// TODO
	appContext.commit('moveNode', {
		nodeGraphId: nodeGraph.value.id,
	});
}
</script>

<style module lang="scss">
.root {
	height: 100%;
}

.nodesContainer {
	height: 100%;
	overflow: auto;
	background: var(--THEME-bg);
}

.nodesContent {
	// ポートと配線を同じ座標系でスクロールさせる。
	position: relative;
	min-height: 100%;
	padding: 8px;
	box-sizing: border-box;
}

.node {
	width: 100%;
}

.addButton {
	margin-top: 8px;
}
</style>
