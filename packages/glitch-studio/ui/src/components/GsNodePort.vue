<template>
<div ref="rootEl" :class="[$style.root, { [$style.output]: output }]" :data-type="dataType?.kind ?? 'any'" :data-wire-anchor="anchorName" :style="{ color: getNodeDataTypeColor(dataType), anchorName }">
	<div :class="$style.icon"></div>
</div>
</template>

<script lang="ts" setup>
import { onMounted, onBeforeUnmount, useId, useTemplateRef } from 'vue';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import { getNodeDataTypeColor } from '@/utility/node-outputs.ts';

defineProps<{
	output?: boolean;
	dataType: TextureDataType | null;
}>();

const emit = defineEmits<{
	(ev: 'update:element', element: HTMLElement | null): void;
}>();

const rootEl = useTemplateRef('rootEl');
const anchorName = `--wire-port-${useId()}`;

// ワイヤーの座標計算やドロップ判定には、コンポーネントではなく実際のDOMを渡す。
onMounted(() => emit('update:element', rootEl.value));
onBeforeUnmount(() => emit('update:element', null));
</script>

<style module lang="scss">
.root {
	--size: var(--NODE_PORT_SIZE, 18px);

	position: relative;
	flex-shrink: 0;
	text-align: center;
	width: var(--size);
	height: var(--size);
	line-height: var(--size);
	user-select: none;
}

.icon {
	position: relative;
	width: 100%;
	height: 100%;
	border-radius: 100%;
	box-sizing: border-box;
	border: solid calc(var(--size) * 0.125) currentColor;

	&:before {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 30%;
		height: 30%;
		border-radius: 100%;
		background-color: transparent;
		border: solid calc(var(--size) * 0.1) currentColor;
		transform: translate(-50%, -50%);
	}
}

.output {
	width: var(--size);
	cursor: crosshair;
	touch-action: none;

	.icon {
		&:before {
			background-color: currentColor;
			border: none;
		}
	}
}
</style>
