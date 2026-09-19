<template>
<div :class="[$style.root]">
	<div :class="[$style.header]">
		<div :class="$style.headerLeft">
			<b>In <i class="ti ti-arrow-right"></i></b>
		</div>
	</div>

	<GsNodeOutputs :node="node"/>
</div>
</template>

<script lang="ts" setup>
import { ref, computed, shallowRef, watchEffect } from 'vue';
import GsNodeOutputs from './GsNodeOutputs.vue';
import type { GsGlobalInNode } from '@glitch/shared/types.ts';
import { wireMap } from '@/app.ts';

const props = defineProps<{
	node: GsGlobalInNode,
}>();

const allInPortEl = shallowRef<HTMLElement | null>(null);

watchEffect(onCleanup => {
	const el = allInPortEl.value;
	const nodeId = props.node.id;
	if (el == null) return;
	wireMap.allIn[nodeId] = el;
	onCleanup(() => {
		if (wireMap.allIn[nodeId] === el) delete wireMap.allIn[nodeId];
	});
});
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
