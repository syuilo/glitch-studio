<template>
<div :class="$style.root" class="_monospace" data-test-preview-rulers>
	<svg :class="$style.xRuler" data-test-preview-x-ruler>
		<g v-for="tick in ticks.x" :key="tick.coordinate" :class="{ [$style.origin]: tick.coordinate === 0 }" :data-test-preview-ruler-coordinate="tick.coordinate">
			<line :x1="tick.position" y1="18" :x2="tick.position" y2="24"/>
			<text :x="labelPosition(tick, viewportSize.width)" y="10" dominant-baseline="middle" text-anchor="middle">{{ tick.label }}</text>
		</g>
	</svg>
	<svg :class="$style.yRuler" data-test-preview-y-ruler>
		<g v-for="tick in ticks.y" :key="tick.coordinate" :class="{ [$style.origin]: tick.coordinate === 0 }" :data-test-preview-ruler-coordinate="tick.coordinate">
			<line x1="18" :y1="tick.position" x2="24" :y2="tick.position"/>
			<text :transform="`translate(10 ${labelPosition(tick, viewportSize.height)}) rotate(-90)`" dominant-baseline="middle" text-anchor="middle">{{ tick.label }}</text>
		</g>
	</svg>
	<div :class="$style.corner"></div>
</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PreviewRulerTick, PreviewViewportSize } from '@/utility/preview-rulers.ts';
import type { PreviewCanvasRect } from '@/utility/preview-transform.ts';
import { getPreviewRulerTicks } from '@/utility/preview-rulers.ts';

const props = defineProps<{ canvasRect: PreviewCanvasRect; viewportSize: PreviewViewportSize }>();
const ticks = computed(() => getPreviewRulerTicks(props.canvasRect, props.viewportSize));

function labelPosition(tick: PreviewRulerTick, length: number): number {
	// 画像端が表示領域の端と一致しても、目盛り線を動かさず数値だけを内側へ寄せて読めるようにする。
	const margin = Math.min(length / 2, tick.label.length * 7 / 2 + 3);
	return Math.min(length - margin, Math.max(margin, tick.position));
}
</script>

<style module lang="scss">
.root {
	position: absolute;
	inset: 0;
	pointer-events: none;
	user-select: none;
	font-size: 11px;
}

.xRuler, .yRuler {
	position: absolute;
	overflow: hidden;
	background: var(--previewOverlayBackground);
	fill: #ddd;

	line {
		stroke: #888;
		stroke-width: 1;
	}
}

.xRuler {
	top: 0;
	left: var(--previewRulerSize);
	width: calc(100% - var(--previewRulerSize));
	height: var(--previewRulerSize);
	box-sizing: border-box;
}

.yRuler {
	top: var(--previewRulerSize);
	left: 0;
	width: var(--previewRulerSize);
	height: calc(100% - var(--previewRulerSize));
	box-sizing: border-box;
}

.origin {
	fill: #fff;

	line {
		stroke: #fff;
	}
}

.corner {
	position: absolute;
	top: 0;
	left: 0;
	width: var(--previewRulerSize);
	height: var(--previewRulerSize);
	background: var(--previewOverlayBackground);
}
</style>
