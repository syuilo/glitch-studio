<template>
<canvas ref="canvas" :class="$style.canvas" :width="width" :height="height" aria-hidden="true"></canvas>
</template>

<script setup lang="ts">
import { onBeforeUnmount, useTemplateRef, watch } from 'vue';
import { createOklchMapPixels } from '@/utility/color-picker-map.ts';

const props = defineProps<{ hue: number }>();
const canvas = useTemplateRef('canvas');
const width = 256;
const height = 150;
let animationFrameId: number | null = null;

watch([canvas, () => props.hue], () => {
	if (animationFrameId != null) cancelAnimationFrame(animationFrameId);
	// 色相ドラッグの入力を1フレームにまとめる。C・L・alphaだけの変更では再描画しない。
	animationFrameId = requestAnimationFrame(() => {
		animationFrameId = null;
		const context = canvas.value?.getContext('2d');
		if (context == null) return;
		const image = context.createImageData(width, height);
		image.data.set(createOklchMapPixels(props.hue, width, height));
		context.putImageData(image, 0, 0);
	});
}, { flush: 'post' });

onBeforeUnmount(() => {
	if (animationFrameId != null) cancelAnimationFrame(animationFrameId);
});
</script>

<style module lang="scss">
.canvas {
	display: block;
	width: 100%;
	height: 100%;
	pointer-events: none;
}
</style>
