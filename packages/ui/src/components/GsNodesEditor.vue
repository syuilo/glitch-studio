<template>
<div :class="$style.root">
	<div v-if="nodeGraph != null" :key="nodeGraph.id" :class="$style.nodesContainer">
		<div :class="$style.nodesContent">
			<Sortable :modelValue="nodeGraph.nodes" :class="$style.nodes" itemKey="id" tag="div" :group="{ name: 'nodes' }" handle=".drag-handle" :animation="150" :swapThreshold="0.5" @change="onSorted">
				<template #item="{element}">
					<XEffectNode v-if="element.type === 'effect'" :key="element.id" :nodeGraphId="nodeGraph.id" :node="element"/>
					<XGlobalInNode v-else-if="element.type === 'globalIn'" :key="element.id" :node="element"/>
					<XGlobalOutNode v-else-if="element.type === 'globalOut'" :key="element.id" :nodeGraphId="nodeGraph.id" :node="element"/>
				</template>
			</Sortable>

			<GsButton :class="$style.addButton" full @click="showAddNodeMenu(nodeGraph.id, $event)">Add node</GsButton>

			<GsWires :nodeGraphId="nodeGraph.id"/>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import Sortable from 'vuedraggable';
import { ref, watch } from 'vue';
import GsWires from './GsWires.vue';
import GsButton from './common/GsButton.vue';
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

function onSorted(event: {
	added?: { element: GsNode; newIndex: number };
	moved?: { element: GsNode; newIndex: number; oldIndex: number };
}) {
	// A cross-group drag also emits removed on the source; commit only at the destination.
	const change = event.added ?? event.moved;
	if (!change || (event.moved && event.moved.oldIndex === event.moved.newIndex)) return;
	appContext.commit('moveNode', {
		nodeGraphId: nodeGraph.value.id,
		nodeId: change.element.id,
		index: change.newIndex,
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

.nodes {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.addButton {
	margin-top: 8px;
}
</style>
