<template>
<div :class="$style.root">
	<div :class="$style.header">
		<button class="_button" style="padding: 4px 6px;"><i class="ti ti-chevron-down"></i> Module: {{ visualModule?.name ?? '' }} [{{ visualModule?.id ?? '' }}]</button>
		<XVisualModuleParamDefsEditor v-if="visualModule != null" :visualModule="visualModule"/>
		<div>Preview:</div>
		<div v-if="visualModule != null" :class="$style.previewParams">
			<GsVisualParam
				v-for="paramDef of visualModule.paramDefs"
				:key="paramDef.id"
				:paramPath="[paramDef.id]"
				:paramDef="paramDef"
				:paramValue="previewParams[paramDef.id]"
				@edit="onPreviewParamEdit"
			/>
		</div>
	</div>
	<div v-if="visualModule != null" :key="visualModule.id" :class="$style.nodesContainer">
		<div :class="$style.nodesContent" class="_gaps_s">
			<GsDraggable
				:modelValue="globalInNodes"
				direction="vertical"
				manualDragStart
				withGaps
				@update:modelValue="onSorted"
			>
				<template #default="{ item: node, dragStart }">
					<XGlobalInNode :visualModule="visualModule" :node="node" :class="$style.node"/>
				</template>
			</GsDraggable>

			<hr>

			<GsDraggable
				:modelValue="visualModule.nodes.filter(node => node.type !== 'globalIn' && node.type !== 'globalOut')"
				direction="vertical"
				manualDragStart
				withGaps
				@update:modelValue="onSorted"
			>
				<template #default="{ item: node, dragStart }">
					<XEffectNode v-if="node.type === 'effect'" :visualModuleId="visualModule.id" :node="node" :class="$style.node" @dragStart="dragStart"/>
				</template>
				<template #footer>
					<GsButton :class="$style.addButton" full style="margin-top: 4px;" @click="showAddNodeMenu(visualModule.id, $event)"><i class="ti ti-plus"></i> Add node...</GsButton>
				</template>
			</GsDraggable>

			<hr>

			<GsDraggable
				:modelValue="globalOutNodes"
				direction="vertical"
				manualDragStart
				withGaps
				@update:modelValue="onSorted"
			>
				<template #default="{ item: node, dragStart }">
					<XGlobalOutNode :node="node" :visualModuleId="visualModule.id" :class="$style.node"/>
				</template>
			</GsDraggable>

			<GsWires :visualModuleId="visualModule.id"/>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { deepClone } from '@glitch/shared/utility/deep-clone.js';
import GsWires from './GsWires.vue';
import GsButton from './common/GsButton.vue';
import GsDraggable from './common/GsDraggable.vue';
import GsVisualParam from './GsVisualParam.vue';
import XEffectNode from './GsEffectNode.vue';
import XGlobalInNode from './GsGlobalInNode.vue';
import XGlobalOutNode from './GsGlobalOutNode.vue';
import XVisualModuleParamDefsEditor from './XVisualModuleParamDefsEditor.vue';
import type { ParamEdit } from './GsVisualParam.vue';
import type { GsGlobalInNode, GsGlobalOutNode, GsNode, VisualModule } from '@glitch/shared/types.js';
import { showAddNodeMenu } from '@/app.ts';
import { appContext } from '@/app.ts';

const visualModule = ref<VisualModule | null>();
const previewParams = ref({});

watch(appContext.state.visualModules, () => {
	if (appContext.state.visualModules.value.length > 0) {
		visualModule.value = appContext.state.visualModules.value[0];
		const defaultParamValues = {};
		for (const paramDef of visualModule.value.paramDefs) {
			defaultParamValues[paramDef.id] = { type: 'literal', value: deepClone(paramDef.defaultValue) };
		}
		previewParams.value = defaultParamValues;
	}
}, { deep: true });

function onPreviewParamEdit(event: ParamEdit) {
	// TODO
}

const globalInNodes = computed(() => {
	return visualModule.value?.nodes.filter((node): node is GsGlobalInNode => node.type === 'globalIn');
});

const globalOutNodes = computed(() => {
	return visualModule.value?.nodes.filter((node): node is GsGlobalOutNode => node.type === 'globalOut');
});

function onSorted(nodes: GsNode[]) {
	// TODO
	appContext.commit('moveNode', {
		visualModuleId: visualModule.value.id,
	});
}
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	height: 100%;
}

.header {
}

.nodesContainer {
	flex: 1;
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
