<template>
<div :class="[$style.root]">
	<div :class="[$style.header]">
		<div :class="$style.headerLeft">
			<b><i class="ti ti-arrow-right"></i> Out</b>
		</div>
	</div>

	<div style="padding: 4px 0;">
		<GsGlobalOutInput v-for="def in visualModule?.outputDefs ?? []" :key="def.id" :visualModuleId="visualModuleId" :node="node" :def="def"/>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import GsGlobalOutInput from './GsGlobalOutInput.vue';
import type { GsGlobalOutNode } from '@glitch/shared/types.ts';
import { appContext } from '@/app.ts';

const props = defineProps<{ visualModuleId: string; node: GsGlobalOutNode }>();
const visualModule = computed(() => appContext.state.visualModules.value.find(module => module.id === props.visualModuleId));
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
