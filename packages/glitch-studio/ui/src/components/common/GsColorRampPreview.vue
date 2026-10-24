<template>
<span :class="$style.root"><canvas ref="canvas" :class="$style.canvas" width="512" height="1"></canvas></span>
</template>

<script setup lang="ts">
import { useTemplateRef, watchEffect } from 'vue';
import { evaluatePreparedColorRamp, prepareColorRamp } from '@gs/shared/color-ramp.ts';
import type { ColorRamp } from '@gs/shared/color-ramp.ts';

const props = defineProps<{ ramp: ColorRamp }>();
const canvas = useTemplateRef('canvas');
watchEffect(() => {
	const context = canvas.value?.getContext('2d');
	if (context == null) return;
	const ramp = prepareColorRamp(props.ramp);
	const pixels = context.createImageData(512, 1);
	for (let x = 0; x < 512; x++) {
		const color = evaluatePreparedColorRamp(ramp, x / 511);
		// ImageDataは未乗算RGBAを受け取る。補間結果は乗算済みなので描画境界で一度だけ戻す。
		const alpha = color[3];
		for (let channel = 0; channel < 3; channel++) pixels.data[x * 4 + channel] = alpha > 0 ? color[channel] / alpha * 255 : 0;
		pixels.data[x * 4 + 3] = alpha * 255;
	}
	context.putImageData(pixels, 0, 0);
});
</script>

<style module lang="scss">
.root {
	display: block;
	height: 24px;
	border-radius: 4px;
	overflow: clip;
	background: repeating-conic-gradient(#888 0% 25%, #ccc 0% 50%) 0 / 12px 12px;
}

.canvas {
	display: block;
	width: 100%;
	height: 100%;
}
</style>
