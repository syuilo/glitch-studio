<template>
<div :class="$style.root">
	<div :class="$style.nodesContainer">
		<div :class="$style.nodesContent">
			<GsNodes :group="null"/>

			<GsButton :class="$style.addButton" full @click="showAddNodeMenu">Add node</GsButton>

			<GsWires/>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import GsNodes from './GsNodes.vue';
import GsWires from './GsWires.vue';
import GsButton from './common/GsButton.vue';
import { showAddNodeMenu } from '@/app.ts';
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

.addButton {
	margin-top: 8px;
}
</style>
