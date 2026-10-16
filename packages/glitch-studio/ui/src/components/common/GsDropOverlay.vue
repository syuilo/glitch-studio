<template>
<div :class="$style.root">{{ i18n.ts._Dialog.DropHere }}</div>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.ts';
</script>

<style module lang="scss">
.root {
	--c1: color(from var(--THEME-accent) srgb r g b / 0.4);
	--c2: color(from var(--THEME-accent) srgb r g b / 0.3);

	position: absolute;
	inset: 0;
	z-index: 10000;
	display: grid;
	place-items: center;
	box-sizing: border-box;
	font-size: 200%;
	border: 2px dashed var(--THEME-accent);
	background: linear-gradient(-45deg, var(--c2) 25%, var(--c1) 25%,var(--c1) 50%, var(--c2) 50%, var(--c2) 75%, var(--c1) 75%, var(--c1));
	background-size: 30px 30px;
	color: var(--THEME-accent);
	pointer-events: none;
}
</style>
