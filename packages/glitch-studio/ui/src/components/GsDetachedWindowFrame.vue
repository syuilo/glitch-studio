<template>
<div :class="$style.root">
	<GsWindowTitlebar v-if="customTitlebar" data-test-detached-window-titlebar>
		<img :src="logoUrl" :class="$style.logo" draggable="false" alt="">
		<span :class="$style.title">{{ title }}</span>
	</GsWindowTitlebar>
	<div :class="$style.content" data-test-detached-window-content>
		<slot></slot>
	</div>
</div>
</template>

<script lang="ts" setup>
import GsWindowTitlebar from './common/GsWindowTitlebar.vue';

defineProps<{
	title: string;
	customTitlebar: boolean;
}>();

// about:blankの子ウィンドウへ移した後も、元のアプリのアイコンを参照する。
const logoUrl = new URL('/gs.svg', window.location.href).href;
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	width: 100%;
	height: 100%;
}

.logo {
	flex-shrink: 0;
	width: 20px;
	height: 20px;
	margin: 0 8px;
}

.title {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.content {
	position: relative;
	flex: 1;
	min-width: 0;
	min-height: 0;
	overflow: clip;
}
</style>
