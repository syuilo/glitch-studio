<template>
<div ref="rootEl">
	<div ref="headerEl" :class="$style.header">
		<slot name="header"></slot>
	</div>
	<div
		:class="$style.body"
		:data-sticky-container-header-height="headerHeight"
		:data-sticky-container-footer-height="footerHeight"
	>
		<slot></slot>
	</div>
	<div ref="footerEl" :class="$style.footer">
		<slot name="footer"></slot>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, provide, inject, ref, useTemplateRef } from 'vue';
import { DI } from '@/ui.ts';

const rootEl = useTemplateRef('rootEl');
const headerEl = useTemplateRef('headerEl');
const footerEl = useTemplateRef('footerEl');

const headerHeight = ref(0);
const parentStickyTop = inject(DI.currentStickyTop, ref(0));
const childStickyTop = computed(() => parentStickyTop.value + headerHeight.value);
provide(DI.currentStickyTop, childStickyTop);

const footerHeight = ref(0);
const parentStickyBottom = inject(DI.currentStickyBottom, ref(0));
const childStickyBottom = computed(() => parentStickyBottom.value + footerHeight.value);
provide(DI.currentStickyBottom, childStickyBottom);

// マウント時や親のsticky位置の変更時にDOMを再計測すると、同期レイアウトを発生させてしまう。
// 初回の高さもResizeObserverに任せ、padding・borderを含む計算済みのサイズから位置を求める。
const observer = new ResizeObserver((entries) => {
	for (const entry of entries) {
		if (entry.target === headerEl.value) {
			headerHeight.value = entry.borderBoxSize[0].blockSize;
		} else if (entry.target === footerEl.value) {
			footerHeight.value = entry.borderBoxSize[0].blockSize;
		}
	}
});

onMounted(() => {
	if (headerEl.value != null) {
		observer.observe(headerEl.value, { box: 'border-box' });
	}

	if (footerEl.value != null) {
		observer.observe(footerEl.value, { box: 'border-box' });
	}
});

onUnmounted(() => {
	observer.disconnect();
});

defineExpose({
	rootEl,
});
</script>

<style lang='scss' module>
.body {
	position: relative;
	z-index: 0;
	--STICKY_TOP: v-bind("childStickyTop + 'px'");
	--STICKY_BOTTOM: v-bind("childStickyBottom + 'px'");
}

.header {
	position: sticky;
	top: var(--STICKY_TOP, 0);
	z-index: 1;
}

.footer {
	position: sticky;
	bottom: var(--STICKY_BOTTOM, 0);
	z-index: 1;
}
</style>
