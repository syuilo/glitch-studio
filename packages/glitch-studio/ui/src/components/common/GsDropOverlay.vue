<template>
<div :class="$style.root">Drop here</div>
</template>

<style module lang="scss">
.root {
	position: absolute;
	inset: 0;
	z-index: 10000;
	display: grid;
	place-items: center;
	box-sizing: border-box;
	border: 2px dashed var(--THEME-accent);
	background: color(from var(--THEME-panel) srgb r g b / 0.85);
	color: var(--THEME-accent);
	font-size: 24px;
	pointer-events: none;
}
</style>
