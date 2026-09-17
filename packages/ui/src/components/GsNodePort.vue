<template>
<div ref="rootEl" :class="[$style.root, { [$style.output]: output }]">・</div>
</template>

<script lang="ts" setup>
import { onMounted, onBeforeUnmount, useTemplateRef } from 'vue';

defineProps<{
	output?: boolean;
}>();

const emit = defineEmits<{
	(ev: 'update:element', element: HTMLElement | null): void;
}>();

const rootEl = useTemplateRef('rootEl');

// ワイヤーの座標計算やドロップ判定には、コンポーネントではなく実際のDOMを渡す。
onMounted(() => emit('update:element', rootEl.value));
onBeforeUnmount(() => emit('update:element', null));
</script>

<style module lang="scss">
.root {
	flex-shrink: 0;
	text-align: center;
	user-select: none;
}

.output {
	width: 24px;
	cursor: crosshair;
	touch-action: none;
}
</style>
