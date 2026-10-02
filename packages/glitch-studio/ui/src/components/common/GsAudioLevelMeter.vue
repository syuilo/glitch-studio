<template>
<div :class="[$style.root, orientation === 'vertical' ? $style.vertical : $style.horizontal]">
	<div v-for="(level, index) in levels" :key="index" :class="$style.track">
		<div :class="$style.cover" :style="{ transform: `${orientation === 'vertical' ? 'scaleY' : 'scaleX'}(${1 - normalizedLevel(level)})` }"></div>
	</div>
</div>
</template>

<script lang="ts" setup>
// Playerに依存しない、チャンネルごとの線形振幅（0が無音、1が0 dBFS）を受け取る表示部品。
withDefaults(defineProps<{
	levels: readonly number[];
	orientation?: 'horizontal' | 'vertical';
}>(), { orientation: 'horizontal' });

function normalizedLevel(level: number): number {
	if (!Number.isFinite(level) || level <= 0) return 0;
	// 振幅をそのまま長さに対応させる。広いdB範囲を線形配置すると、
	// 振幅0.5（約-6 dBFS）でもほぼ全点灯になり、強弱を読み取りにくい。
	return Math.min(1, level);
}
</script>

<style module lang="scss">
.root {
	position: relative;
	display: flex;
	gap: 2px;
	width: 100%;
	height: 100%;
	min-width: 0;
	min-height: 0;
	overflow: clip;
	contain: strict;
}

.track {
	position: relative;
	flex: 1;
	min-width: 0;
	min-height: 0;
	overflow: hidden;
	border-radius: 2px;
}

.cover {
	position: absolute;
	inset: 0;
	background: #000;
	// グラデーション自体は伸縮せず、未点灯部分だけを覆う。レイアウト計算は不要。
	transition: transform 65ms linear;
	will-change: transform; // これが無いとChromeのバグがしらんけど全く関係ないコンポーネントのradius描画がちらつく
}

.horizontal {
	flex-direction: column;

	.track { background: linear-gradient(to right, #28c65c 0%, #87d444 55%, #efd43b 75%, #ef8636 88%, #ed4141 100%); }
	.cover { transform-origin: right; }
}

.vertical {
	flex-direction: row;

	.track { background: linear-gradient(to top, #28c65c 0%, #87d444 55%, #efd43b 75%, #ef8636 88%, #ed4141 100%); }
	.cover { transform-origin: top; }
}
</style>
