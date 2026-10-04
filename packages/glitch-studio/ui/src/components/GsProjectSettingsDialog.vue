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
		<GsInput v-model="timelineFps" type="number" :min="1" :max="120" :step="'any'"><template #label>Timeline frame rate</template><template #suffix>fps</template></GsInput>
		<GsSwitch v-model="timelineMotionBlur.enabled">Motion blur</GsSwitch>
		<div class="_gaps_m" :inert="!timelineMotionBlur.enabled">
			<GsInput v-model="timelineMotionBlur.shutterAngle" type="number" :min="0" :max="360" :step="'any'"><template #label>Shutter angle</template><template #suffix>°</template><template #caption>Centered exposure: {{ exposureMs }} ms at the project frame rate. Clip boundaries shorten the exposure.</template></GsInput>
			<GsInput v-model="timelineMotionBlur.samples" type="number" :min="0" :max="MAX_MOTION_BLUR_SAMPLES" :step="1"><template #label>Samples</template><template #caption>0 disables motion blur; 1 renders the current time without blur.</template></GsInput>
			<GsInput v-model="timelineMotionBlur.previewSamples" type="number" :min="0" :max="MAX_MOTION_BLUR_SAMPLES" :step="1"><template #label>Preview samples</template><template #caption>Only preview quality changes. The exposure time stays the same.</template></GsInput>
		</div>
		<div v-if="timelineMotionBlur.enabled && historyEffects.length" :class="$style.warning">
			Motion blur does not support effects that depend on render history: {{ historyEffects.join(', ') }}.
			Rendering is allowed, but results may vary with sample count and preview frame rate, and may differ from export.
		</div>
		<div v-if="renderSettingsError">{{ renderSettingsError }}</div>
		<div :class="$style.actions">
			<GsButton inline @click="closeDialog">Cancel</GsButton>
			<GsButton inline primary :disabled="!isResolutionValid || renderSettingsError != null" @click="apply">OK</GsButton>
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
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { MAX_MOTION_BLUR_SAMPLES, validateTimelineFps, validateTimelineMotionBlur } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import { findTimelineHistoryEffects } from '@gs/subsystems_timeline_shared/render-history-effects.ts';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';

const modal = useTemplateRef('modal');
const dialogContent = useTemplateRef('dialogContent');

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const width = ref(appStateManager.state.resolution.value.width);
const height = ref(appStateManager.state.resolution.value.height);
const timelineFps = ref(appStateManager.state.timelineFps.value);
const timelineMotionBlur = ref(deepClone(appStateManager.state.timelineMotionBlur.value));
const renderSettingsError = computed(() => {
	try {
		validateTimelineFps(timelineFps.value);
		validateTimelineMotionBlur(timelineMotionBlur.value);
		return null;
	} catch (error) { return error instanceof Error ? error.message : String(error); }
});
const exposureMs = computed(() => renderSettingsError.value ? '—' : (1000 / timelineFps.value * timelineMotionBlur.value.shutterAngle / 360).toFixed(2));
const historyEffects = computed(() => findTimelineHistoryEffects(appStateManager.state.timelineScenes.value,
	id => appStateManager.state.visualModules.value.find(visualModule => visualModule.id === id), effectDefinitions)
	.map(id => effectDefinitions[id].displayName));
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
	if (!isResolutionValid.value || renderSettingsError.value != null) return;
	const currentResolution = appStateManager.state.resolution.value;
	if (width.value !== currentResolution.width || height.value !== currentResolution.height) {
		appStateManager.commit('changeProjectResolution', { width: width.value, height: height.value });
	}
	if (timelineFps.value !== appStateManager.state.timelineFps.value || !deepEqual(timelineMotionBlur.value, appStateManager.state.timelineMotionBlur.value)) {
		appStateManager.commit('changeTimelineRenderSettings', { timelineFps: timelineFps.value, timelineMotionBlur: timelineMotionBlur.value });
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
	max-height: 85vh;
	overflow-y: auto;
	box-sizing: border-box;
	background: var(--THEME-dialog);
	border-radius: 10px;
}

.actions {
	display: flex;
	justify-content: flex-end;
	gap: 12px;
}

.warning {
	color: #e7b455;
}
</style>
