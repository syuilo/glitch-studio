<template>
<div
	:key="key"
	:class="[$style.root, { [$style.waiting]: progress == null }]" :style="{
		'--p': progress != null ? `${progress * 100}%` : '0%',
	}"
>
</div>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue';

const props = withDefaults(defineProps<{
	progress: number | null; // nullでwaiting状態を表す
}>(), {
});

// 進捗が0にリセットされたとき(減少したとき)やwaiting状態への移行ではtransitionさせないためのkey
const key = ref(0);

watch(() => props.progress, (after, before) => {
	if (after == null || before == null) {
		key.value++;
		return;
	}

	if (after < before) key.value++;
});

</script>

<style lang="scss" module>
.root {
	--c1: color(from var(--THEME-accent) srgb r g b / 0.25);
	--c2: color(from var(--THEME-accent) srgb r g b / 0.125);
	position: relative;
	height: 5px;
	border-radius: 999px;
	overflow: clip;
	background: linear-gradient(-45deg, var(--c2) 25%, var(--c1) 25%,var(--c1) 50%, var(--c2) 50%, var(--c2) 75%, var(--c1) 75%, var(--c1));
	background-size: 30px 30px;
	animation: stripe .8s infinite linear;

	&::before {
		content: '';
		display: block;
		position: absolute;
		top: 0;
		left: 0;
		width: var(--p);
		height: 100%;
		background: var(--THEME-accent);
		transition: all 0.5s cubic-bezier(0,.5,.5,1);
	}

	&.waiting {
		--c1: var(--THEME-accent);
		--c2: color(from var(--THEME-accent) srgb r g b / 0.5);

		background: linear-gradient(-45deg, var(--c2) 25%, var(--c1) 25%,var(--c1) 50%, var(--c2) 50%, var(--c2) 75%, var(--c1) 75%, var(--c1));
		background-size: 30px 30px;
	}
}

@keyframes stripe {
	0% { background-position-x: 0; }
	100% { background-position-x: -30px; }
}
</style>
