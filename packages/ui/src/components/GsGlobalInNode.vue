<template>
<div :class="[$style.root]">
	<div :class="[$style.header]">
		<div :class="$style.headerLeft">
			<b>In <i class="ti ti-arrow-right"></i></b>
		</div>
	</div>

	<GsNodeOutputs :node="node" :paramDefs="visualModule.paramDefs"/>
</div>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import GsNodeOutputs from './GsNodeOutputs.vue';
import type { VisualModule, VisualModuleGlobalInNode } from '@glitch/shared/visual-module/types.js';

const props = defineProps<{
	visualModule: VisualModule,
	node: VisualModuleGlobalInNode,
}>();
</script>

<style module lang="scss">
.root {
	position: relative;
	background: var(--THEME-nodeBg);
	border-radius: 6px;
	overflow: clip;
	contain: content;
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
