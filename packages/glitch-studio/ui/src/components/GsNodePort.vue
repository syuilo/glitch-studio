<template>
<div ref="rootEl" :class="[$style.root, { [$style.output]: output, [$style.placeholder]: placeholder }]" :data-type="dataType?.kind ?? 'any'" :data-wire-anchor="anchorName" :style="{ color: getNodeDataTypeColor(dataType), anchorName }">
	<svg :class="$style.icon" xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
		<path v-if="!placeholder" style="fill: currentColor;" shape-rendering="geometricPrecision" d="M64,0C99.323,0 128,28.677 128,64C128,99.323 99.323,128 64,128C28.677,128 0,99.323 0,64C0,28.677 28.677,0 64,0ZM64,12C35.3,12 12,35.3 12,64C12,92.7 35.3,116 64,116C92.7,116 116,92.7 116,64C116,35.3 92.7,12 64,12Z"/>
		<circle v-if="output" style="fill: currentColor;" shape-rendering="geometricPrecision" cx="64" cy="64" r="12"/>
		<g v-else transform="matrix(0.75,0,0,0.75,16,16)">
			<path style="fill: currentColor;" shape-rendering="geometricPrecision" d="M64,32C81.661,32 96,46.339 96,64C96,81.661 81.661,96 64,96C46.339,96 32,81.661 32,64C32,46.339 46.339,32 64,32ZM64,48C55.169,48 48,55.169 48,64C48,72.831 55.169,80 64,80C72.831,80 80,72.831 80,64C80,55.169 72.831,48 64,48Z"/>
		</g>
	</svg>
</div>
</template>

<script lang="ts" setup>
import { onMounted, onBeforeUnmount, useId, useTemplateRef } from 'vue';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import { getNodeDataTypeColor } from '@/utility/node-outputs.ts';

defineProps<{
	output?: boolean;
	placeholder?: boolean;
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
	--size: var(--NODE_PORT_SIZE, 16px);

	position: relative;
	flex-shrink: 0;
	text-align: center;
	width: var(--size);
	height: var(--size);
	line-height: var(--size);
	user-select: none;

	&.placeholder {
		color: #fff2 !important;
	}
}

.icon {
	position: relative;
	width: 100%;
	height: 100%;
	box-sizing: border-box;
}

.output {
	width: var(--size);
	cursor: crosshair;
	touch-action: none;
}
</style>
