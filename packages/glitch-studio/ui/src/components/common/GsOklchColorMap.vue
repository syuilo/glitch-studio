<template>
<canvas ref="canvas" :class="$style.canvas" :width="width" :height="height" data-test-oklch-map-canvas></canvas>
</template>

<script setup lang="ts">
import { onBeforeUnmount, useTemplateRef, watch } from 'vue';
import { createOklchMapPixels } from '@/utility/color-picker-map.ts';
import type { RgbGamut } from '@gs/shared/rgb-gamut.ts';

const props = defineProps<{ hue: number; gamut: RgbGamut }>();
const canvas = useTemplateRef('canvas');
const width = 256;
const height = 150;
let animationFrameId: number | null = null;

watch([canvas, () => props.hue, () => props.gamut], () => {
	if (animationFrameId != null) cancelAnimationFrame(animationFrameId);
	// 色相・判定色域の変更を1フレームにまとめる。C・L・alphaだけの変更では再描画しない。
	animationFrameId = requestAnimationFrame(() => {
		animationFrameId = null;
		// @types/webにはまだcolorType・toneMappingがないため、オプションを変数として渡す。
		// 拡張sRGBのfloat画素を保持し、モニター色空間への変換はブラウザーに委ねる。
		const options: CanvasRenderingContext2DSettings & { colorType: 'float16'; toneMapping: { mode: 'standard' } } = {
			colorSpace: 'srgb', colorType: 'float16', toneMapping: { mode: 'standard' },
		};
		const context = canvas.value?.getContext('2d', options);
		if (context == null) return;
		const attributes = context.getContextAttributes() as CanvasRenderingContext2DSettings & { colorType?: string };
		const wideGamut = attributes.colorType === 'float16';
		const image = context.createImageData(width, height, { colorSpace: 'srgb', pixelFormat: wideGamut ? 'rgba-float16' : 'rgba-unorm8' });
		const pixels = createOklchMapPixels(props.hue, width, height, props.gamut);
		if (wideGamut) image.data.set(pixels);
		else {
			// float Canvasを使えない環境でも、判定と選択色は保持して見本だけSDRへ制限する。
			for (let index = 0; index < pixels.length; index++) image.data[index] = pixels[index] * 255;
		}
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
