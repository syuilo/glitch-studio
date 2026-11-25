<template>
<canvas ref="canvas" :class="$style.preview" :width="WIDTH" :height="HEIGHT"/>
</template>

<script lang="ts" setup>
import { useTemplateRef, watchEffect } from 'vue';
import { evaluateFunctionCurve } from '@gs/shared/function-curve/function-curve-evaluator.ts';
import type { FixedFunctionCurve } from '@gs/shared/function-curve/function-curve.ts';

const props = defineProps<{ curve: FixedFunctionCurve }>();
const canvas = useTemplateRef('canvas');
const WIDTH = 512;
const HEIGHT = 192;
const PADDING = 12;

watchEffect(() => {
	const element = canvas.value;
	if (element == null) return;
	const context = element.getContext('2d');
	if (context == null) return;

	const curve = props.curve;
	const sampleCount = WIDTH - PADDING * 2;
	const samples = Array.from({ length: sampleCount + 1 }, (_, index) => evaluateFunctionCurve(curve, index / sampleCount, 'clamp'));
	// イージングのオーバーシュートも収めつつ、すべての種類でY=0とY=1を示す。
	const min = Math.min(0, ...samples);
	const max = Math.max(1, ...samples);
	const screenY = (y: number) => HEIGHT - PADDING - (y - min) / (max - min) * (HEIGHT - PADDING * 2);
	const colors = getComputedStyle(element);
	context.clearRect(0, 0, WIDTH, HEIGHT);
	context.strokeStyle = colors.getPropertyValue('--THEME-divider').trim() || colors.color;
	context.lineWidth = 1;
	context.strokeRect(PADDING, screenY(1), sampleCount, screenY(0) - screenY(1));

	context.strokeStyle = colors.getPropertyValue('--THEME-accent').trim() || colors.color;
	context.lineWidth = 2;
	context.beginPath();
	context.moveTo(PADDING, screenY(samples[0]));
	const hasSteps = curve.type === 'steps' || curve.type === 'pulse';
	for (let index = 1; index < samples.length; index++) {
		const x = PADDING + index;
		if (hasSteps) context.lineTo(x, screenY(samples[index - 1]));
		context.lineTo(x, screenY(samples[index]));
	}
	context.stroke();
}, { flush: 'post' });
</script>

<style lang="scss" module>
.preview {
	display: block;
	width: 100%;
	height: auto;
	max-height: 100%;
	object-fit: contain;
}
</style>
