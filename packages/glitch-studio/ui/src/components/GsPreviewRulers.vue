<template>
<div :class="$style.root" class="_monospace" data-test-preview-rulers>
	<svg :class="$style.xRuler" data-test-preview-x-ruler>
		<line v-if="coordinateRange != null && hasVisibleRangeEndpoint(coordinateRange.left, coordinateRange.right, viewportSize.width)" :x1="coordinateRange.left" y1="18.5" :x2="coordinateRange.right" y2="18.5" data-test-preview-ruler-range/>
		<g v-for="tick in ticks.x" :key="tick.coordinate" :class="{ [$style.origin]: tick.coordinate === 0 }" :data-test-preview-ruler-coordinate="tick.coordinate">
			<line :x1="tick.position" y1="18" :x2="tick.position" y2="24"/>
			<text :class="{ [$style.secondaryLabel]: tick.coordinate !== 0 && Math.abs(tick.coordinate) !== 0.5 }" :x="labelPosition(tick, viewportSize.width)" y="10" dominant-baseline="middle" text-anchor="middle">{{ tick.label }}</text>
		</g>
	</svg>
	<svg :class="$style.yRuler" data-test-preview-y-ruler>
		<line v-if="coordinateRange != null && hasVisibleRangeEndpoint(coordinateRange.top, coordinateRange.bottom, viewportSize.height)" x1="18.5" :y1="coordinateRange.top" x2="18.5" :y2="coordinateRange.bottom" data-test-preview-ruler-range/>
		<g v-for="tick in ticks.y" :key="tick.coordinate" :class="{ [$style.origin]: tick.coordinate === 0 }" :data-test-preview-ruler-coordinate="tick.coordinate">
			<line x1="18" :y1="tick.position" x2="24" :y2="tick.position"/>
			<text :class="{ [$style.secondaryLabel]: tick.coordinate !== 0 && Math.abs(tick.coordinate) !== 0.5 }" :transform="`translate(10 ${labelPosition(tick, viewportSize.height)}) rotate(-90)`" dominant-baseline="middle" text-anchor="middle">{{ tick.label }}</text>
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
const coordinateRange = computed(() => {
	const { left, top, width, height } = props.canvasRect;
	if (width <= 0 || height <= 0) return null;
	// 共通座標の単位は両軸とも長辺全体なので、短辺側の±0.5は画像外に位置する。
	// 縮小時に±0.5の目盛りが省略されても範囲を示せるよう、目盛りとは独立して計算する。
	const halfLongSide = Math.max(width, height) / 2;
	const originX = left + width / 2;
	const originY = top + height / 2;
	return { left: originX - halfLongSide, right: originX + halfLongSide, top: originY - halfLongSide, bottom: originY + halfLongSide };
});

function hasVisibleRangeEndpoint(start: number, end: number, viewportLength: number): boolean {
	// 片端が見えていれば範囲線を残す。両端が領域外の場合は、領域を横断していても表示しない。
	return (start >= 0 && start <= viewportLength) || (end >= 0 && end <= viewportLength);
}

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
	fill: #fffd;

	line {
		stroke: #fff4;
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

.secondaryLabel {
	fill: rgb(221 221 221 / 50%);
}

.origin {

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
