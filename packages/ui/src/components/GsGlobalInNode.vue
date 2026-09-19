<template>
<div :class="[$style.root]">
	<div :class="[$style.header]">
		<div :class="$style.headerLeft">
			<b>In <i class="ti ti-arrow-right"></i></b>
		</div>
	</div>

	<div :class="$style.parameter">
		<GsSelect small :modelValue="selectedParamId" :items="paramItems" @update:modelValue="selectParam"/>
		<span v-if="selectedParamId == null" :class="$style.missing">Select a node-capable parameter</span>
	</div>

	<GsNodeOutputs :node="node" :paramDefs="visualModule.paramDefs"/>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import GsNodeOutputs from './GsNodeOutputs.vue';
import GsSelect from './common/GsSelect.vue';
import type { GsGlobalInNode, VisualModule } from '@glitch/shared/types.ts';
import { appContext } from '@/app.ts';

const props = defineProps<{
	visualModule: VisualModule,
	node: GsGlobalInNode,
}>();

const paramItems = computed(() => props.visualModule.paramDefs.filter(def => def.canNode)
	.map(def => ({ label: `${def.label} (${def.name})`, value: def.id })));
const selectedParamId = computed(() => paramItems.value.some(item => item.value === props.node.paramId) ? props.node.paramId : null);

function selectParam(paramId: string | null) {
	if (paramId == null) return;
	appContext.commit('updateGlobalInParam', { visualModuleId: props.visualModule.id, nodeId: props.node.id, paramId });
}
</script>

<style module lang="scss">
.root {
	position: relative;
	background: var(--THEME-nodeBg);
	border-radius: 6px;
	overflow: clip;
	contain: content;
}

.parameter {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 8px 16px;
}

.missing {
	color: var(--THEME-warn);
	font-size: 85%;
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
