<template>
<div ref="preview" v-tooltip="title ?? i18n.ts._ColorRamp.Title" class="_button" :class="$style.root" data-test-color-ramp data-test-color-ramp-toggle tabindex="0" @click="openPopup" @keydown.enter.prevent="openPopup" @keydown.space.prevent="openPopup">
	<GsColorRampPreview :ramp="modelValue"/>
</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, useTemplateRef } from 'vue';
import GsColorRampPreview from './GsColorRampPreview.vue';
import GsColorRampEditor from './GsColorRampEditor.vue';
import type { ColorRamp } from '@gs/shared/color-ramp.ts';
import * as ui from '@/ui.ts';
import { i18n } from '@/i18n.ts';

const props = defineProps<{ modelValue: ColorRamp; title?: string }>();
const emit = defineEmits<{
	(ev: 'update:modelValue', value: ColorRamp): void;
	(ev: 'beginChanging'): void;
	(ev: 'changeFinished'): void;
}>();

const preview = useTemplateRef('preview');
let closePopup: (() => void) | null = null;

function openPopup() {
	if (closePopup != null || preview.value == null) return;

	let active = true;
	let closing = false;
	let changing = false;
	let dispose: (() => void) | null = null;

	function finishChanging() {
		if (!changing) return;
		changing = false;
		emit('changeFinished');
	}

	function disposePopup() {
		if (!active) return;
		active = false;
		closePopup = null;
		dispose?.();
		finishChanging();
	}

	closePopup = disposePopup;
	dispose = ui.popup(GsColorRampEditor, {
		modelValue: computed(() => props.modelValue),
		anchorElement: preview.value,
		title: props.title,
	}, {
		'update:modelValue': value => {
			// 閉じる際のblurや親の破棄後に届く通知で、確定済みの編集を再開しない。
			if (!active || closing) return;
			if (!changing) {
				changing = true;
				emit('beginChanging');
			}
			emit('update:modelValue', value);
		},
		closing: () => {
			if (!active) return;
			closing = true;
			finishChanging();
		},
		closed: () => {
			if (!active) return;
			disposePopup();
			preview.value?.focus({ preventScroll: true });
		},
	}).dispose;
}

onBeforeUnmount(() => closePopup?.());
</script>

<style module lang="scss">
.root {
	min-width: 0;
	width: 100%;
}
</style>
