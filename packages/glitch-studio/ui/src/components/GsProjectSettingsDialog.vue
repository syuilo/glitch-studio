<template>
<GsModal ref="modal" preferType="dialog" @opened="dialogContent?.focus()" @closed="emit('closed')" @esc="closeDialog" @click="closeDialog">
	<div ref="dialogContent" :class="$style.root" class="_gaps_m" tabindex="-1" @keydown.stop @keydown.esc.prevent="closeDialog">
		<div>Project settings</div>
		<div>Resolution</div>
		<div style="display: flex; gap: 12px;">
			<GsInput style="flex: 1; min-width: 0;" :modelValue="width" type="number" :min="1" :step="1" @update:modelValue="updateWidth"><template #label>Width</template><template #suffix>px</template></GsInput>
			<GsInput style="flex: 1; min-width: 0;" :modelValue="height" type="number" :min="1" :step="1" @update:modelValue="updateHeight"><template #label>Height</template><template #suffix>px</template></GsInput>
		</div>
		<GsSwitch :modelValue="lockedAspectRatio != null" :disabled="lockedAspectRatio == null && !isResolutionValid" @update:modelValue="setAspectRatioLocked">Keep aspect ratio</GsSwitch>
		<div v-if="!isResolutionValid">Width and height must be positive integers.</div>
		<div :class="$style.actions">
			<GsButton inline @click="closeDialog">Cancel</GsButton>
			<GsButton inline primary :disabled="!isResolutionValid" @click="apply">OK</GsButton>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { computed, ref, useTemplateRef } from 'vue';
import GsModal from './common/GsModal.vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsSwitch from './common/GsSwitch.vue';
import { appStateManager } from '@/app.ts';

const modal = useTemplateRef('modal');
const dialogContent = useTemplateRef('dialogContent');

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const width = ref(appStateManager.state.resolution.value.width);
const height = ref(appStateManager.state.resolution.value.height);
const lockedAspectRatio = ref<number | null>(width.value / height.value);
const isResolutionValid = computed(() => isValidDimension(width.value) && isValidDimension(height.value));

function isValidDimension(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0;
}

function setAspectRatioLocked(locked: boolean) {
	if (locked && !isResolutionValid.value) return;
	// 整数pxへの丸めで比率が少し変わっても、連続編集で誤差が蓄積しないよう固定時の比率を保持する。
	lockedAspectRatio.value = locked ? width.value / height.value : null;
}

function updateWidth(value: number) {
	width.value = value;
	if (lockedAspectRatio.value != null && isValidDimension(value)) {
		height.value = Math.max(1, Math.round(value / lockedAspectRatio.value));
	}
}

function updateHeight(value: number) {
	height.value = value;
	if (lockedAspectRatio.value != null && isValidDimension(value)) {
		width.value = Math.max(1, Math.round(value * lockedAspectRatio.value));
	}
}

function closeDialog() {
	modal.value?.close();
}

function apply() {
	if (!isResolutionValid.value) return;
	const currentResolution = appStateManager.state.resolution.value;
	if (width.value !== currentResolution.width || height.value !== currentResolution.height) {
		appStateManager.commit('changeProjectResolution', { width: width.value, height: height.value });
	}
	closeDialog();
}

</script>

<style module lang="scss">
.root {
	margin: auto;
	position: relative;
	padding: 32px;
	width: 480px;
	max-width: 85vw;
	box-sizing: border-box;
	background: var(--THEME-dialog);
	border-radius: 10px;
}

.actions {
	display: flex;
	justify-content: flex-end;
	gap: 12px;
}
</style>
