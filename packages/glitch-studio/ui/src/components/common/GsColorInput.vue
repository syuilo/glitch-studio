<template>
<div ref="preview" :class="[$style.root, { [$style.disabled]: disabled }]" tabindex="0" @click="open" @keydown.enter.prevent="open" @keydown.space.prevent="open">
	<div :class="$style.color" :style="{ background: colorCss(modelValue) }"></div>
	<div class="_monospace">{{ colorHex(modelValue) }}</div>
</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, useTemplateRef, watch } from 'vue';
import type { RgbaColor } from '@/utility/color-input.ts';
import { colorCss, colorHex } from '@/utility/color-input.ts';
import GsColorPicker from '@/components/common/GsColorPicker.vue';
import * as ui from '@/ui.ts';

const props = defineProps<{
	modelValue: RgbaColor;
	disabled?: boolean;
	title?: string;
}>();

const emit = defineEmits<{
	(ev: 'update:modelValue', value: RgbaColor): void;
	(ev: 'beginChanging'): void;
	(ev: 'changeFinished'): void;
}>();

const preview = useTemplateRef('preview');
let dispose: (() => void) | undefined;
let changing = false;

function close() {
	dispose?.();
	dispose = undefined;
	if (changing) {
		changing = false;
		emit('changeFinished');
	}
}

function open() {
	if (props.disabled || dispose || !preview.value) return;
	dispose = ui.popup(GsColorPicker, {
		modelValue: computed(() => props.modelValue),
		anchorElement: preview.value,
		title: props.title,
	}, {
		'update:modelValue': value => {
			if (!changing) {
				changing = true;
				emit('beginChanging');
			}
			emit('update:modelValue', value);
		},
		closed: () => {
			close();
			preview.value?.focus({ preventScroll: true });
		},
	}).dispose;
}

watch(() => props.disabled, disabled => { if (disabled) close(); });
onBeforeUnmount(close);
</script>

<style module lang="scss">
.root {
	display: flex;
	align-items: center;
	gap: 16px;
	cursor: pointer;
}

.color {
	width: 24px;
	height: 24px;
	border-radius: 4px;
	overflow: clip;
	background: repeating-conic-gradient(#888 0% 25%, #ccc 0% 50%) 0 / 12px 12px;
}

.disabled { opacity: 0.5; cursor: default; }
</style>
