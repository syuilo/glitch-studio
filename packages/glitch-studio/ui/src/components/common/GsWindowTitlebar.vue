<template>
<header :class="$style.root">
	<div :class="$style.inner">
		<slot></slot>
	</div>
</header>
</template>

<style module lang="scss">
.root {
	flex-shrink: 0;
	height: 32px;
	line-height: 32px;
	box-sizing: border-box;
	app-region: drag;
	background: linear-gradient(0deg, var(--THEME-panel), hsl(from var(--THEME-panel) h s calc(l + 5)));
}

.inner {
	display: flex;
	align-items: center;
	// OSの操作ボタンはプラットフォームによって左右が異なるため、その領域を避ける。
	margin-left: env(titlebar-area-x, 0px);
	width: env(titlebar-area-width, 100%);
	height: 100%;
	box-sizing: border-box;
}
</style>
