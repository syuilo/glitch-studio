<template>
<div ref="preview" v-tooltip="title ?? i18n.ts._ColorRamp.Title" class="_button" :class="$style.root" data-test-color-ramp data-test-color-ramp-toggle tabindex="0" @click="openPopup" @keydown.enter.prevent="openPopup" @keydown.space.prevent="openPopup">
	<GsColorRampPreview :ramp="modelValue"/>
	<Teleport to="body">
		<GsColorRampEditor
			v-if="popupState != null && preview != null" :modelValue="modelValue" :anchorElement="preview" :title="title"
			@update:modelValue="updateRamp" @closing="finishEditing('closing')" @closed="onClosed"
		/>
	</Teleport>
</div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, useTemplateRef } from 'vue';
import GsColorRampPreview from './GsColorRampPreview.vue';
import GsColorRampEditor from './GsColorRampEditor.vue';
import type { ColorRamp } from '@gs/shared/color-ramp.ts';
import { i18n } from '@/i18n.ts';

defineProps<{ modelValue: ColorRamp; title?: string }>();
const emit = defineEmits<{
	(ev: 'update:modelValue', value: ColorRamp): void;
	(ev: 'beginChanging'): void;
	(ev: 'changeFinished'): void;
}>();

const preview = useTemplateRef('preview');
const popupState = ref<'open' | 'closing' | null>(null);
let changing = false;

function openPopup() {
	if (popupState.value != null || preview.value == null) return;
	popupState.value = 'open';
}

function updateRamp(value: ColorRamp) {
	// 終了アニメーション中や親の破棄後の通知で、確定済みの編集を再開しない。
	if (popupState.value !== 'open') return;
	if (!changing) {
		changing = true;
		emit('beginChanging');
	}
	emit('update:modelValue', value);
}

function finishEditing(nextState: 'closing' | null) {
	if (popupState.value == null) return;
	// closingではEditorを残して終了アニメーションを待ち、closedまたは親の破棄で除く。
	popupState.value = nextState;
	if (!changing) return;
	changing = false;
	emit('changeFinished');
}

function onClosed() {
	if (popupState.value == null) return;
	finishEditing(null);
	preview.value?.focus({ preventScroll: true });
}

onBeforeUnmount(() => finishEditing(null));
</script>

<style module lang="scss">
.root {
	min-width: 0;
	width: 100%;
}
</style>
