<template>
<GsModal ref="modal" preferType="dialog" @opened="dialogContent?.focus()" @closed="emit('closed')" @esc="closeDialog" @click="closeDialog">
	<div ref="dialogContent" :class="$style.root" class="_gaps_m" tabindex="-1" @keydown.stop @keydown.esc.prevent="closeDialog">
		<div>{{ i18n.ts._Project.Settings }}</div>
		<div>{{ i18n.ts._Project.BaseResolution }}</div>
		<div style="display: flex; gap: 12px;">
			<GsInput large style="flex: 1; min-width: 0;" :modelValue="width" type="number" :min="1" :step="1" @update:modelValue="updateWidth"><template #label>{{ i18n.ts.Width }}</template><template #suffix>px</template></GsInput>
			<GsButton iconOnly :primary="lockedAspectRatio != null" icon="ti ti-link" @click="toggleAspectRatioLock"/>
			<GsInput large style="flex: 1; min-width: 0;" :modelValue="height" type="number" :min="1" :step="1" @update:modelValue="updateHeight"><template #label>{{ i18n.ts.Height }}</template><template #suffix>px</template></GsInput>
		</div>
		<div v-if="!isResolutionValid">{{ i18n.ts._Project.InvalidResolution }}</div>
		<GsInput v-model="timelineFps" large type="number" :min="1" :max="120" :step="'any'"><template #label>{{ i18n.ts._Project.BaseTimelineFps }}</template><template #suffix>fps</template></GsInput>
		<GsFolder>
			<template #icon><i class="ti ti-reduce-motion"></i></template>
			<template #label>{{ i18n.ts._Project.MotionBlur }}</template>
			<template #suffix>{{ timelineMotionBlur.enabled ? i18n.ts.Enabled : i18n.ts.Disabled }}</template>
			<div class="_gaps_l">
				<GsSwitch v-model="timelineMotionBlur.enabled">{{ i18n.ts.Enable }}</GsSwitch>
				<div class="_gaps_m" :inert="!timelineMotionBlur.enabled">
					<GsInput v-model="timelineMotionBlur.shutterAngle" large type="number" :min="0" :max="360" :step="'any'"><template #label>{{ i18n.ts._Project.ShutterAngle }}</template><template #suffix>°</template></GsInput>
					<GsInput v-model="timelineMotionBlur.samples" large type="number" :min="0" :max="MAX_MOTION_BLUR_SAMPLES" :step="1"><template #label>{{ i18n.ts._Project.ExportSamples }}</template></GsInput>
				</div>
				<div v-if="timelineMotionBlur.enabled && historyEffects.length" :class="$style.warning">
					<i class="ti ti-alert-triangle" style="color: var(--THEME-warn);"></i> {{ i18n.ts._Project.MotionBlurUnsupported }} {{ historyEffects.join(', ') }}.
				</div>
			</div>
		</GsFolder>
		<div v-if="renderSettingsError">{{ renderSettingsError }}</div>
		<div :class="$style.actions">
			<GsButton large inline @click="closeDialog">{{ i18n.ts.Cancel }}</GsButton>
			<GsButton large inline primary :disabled="!isResolutionValid || renderSettingsError != null" @click="apply">{{ i18n.ts.OK }}</GsButton>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.ts';
import { computed, ref, useTemplateRef } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { MAX_MOTION_BLUR_SAMPLES, validateTimelineFps, validateTimelineMotionBlur } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import { findTimelineHistoryEffects } from '@gs/subsystems_timeline_shared/render-history-effects.ts';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import GsSwitch from './common/GsSwitch.vue';
import GsInput from './common/GsInput.vue';
import GsButton from './common/GsButton.vue';
import GsModal from './common/GsModal.vue';
import GsFolder from './common/GsFolder.vue';
import { appContext } from '@/app.ts';

const { stateManager } = appContext.projectContext;

const modal = useTemplateRef('modal');
const dialogContent = useTemplateRef('dialogContent');

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const width = ref(stateManager.state.resolution.value.width);
const height = ref(stateManager.state.resolution.value.height);
const timelineFps = ref(stateManager.state.timelineFps.value);
const timelineMotionBlur = ref(deepClone(stateManager.state.timelineMotionBlur.value));
const renderSettingsError = computed(() => {
	try {
		validateTimelineFps(timelineFps.value);
		validateTimelineMotionBlur(timelineMotionBlur.value);
		return null;
	} catch (error) { return error instanceof Error ? error.message : String(error); }
});
const exposureMs = computed(() => renderSettingsError.value ? '—' : (1000 / timelineFps.value * timelineMotionBlur.value.shutterAngle / 360).toFixed(2));
const historyEffects = computed(() => findTimelineHistoryEffects(stateManager.state.timelineScenes.value,
	id => stateManager.state.visualModules.value.find(visualModule => visualModule.id === id) ?? null, effectDefinitions)
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

function toggleAspectRatioLock() {
	setAspectRatioLocked(lockedAspectRatio.value == null);
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
	const currentResolution = stateManager.state.resolution.value;
	if (width.value !== currentResolution.width || height.value !== currentResolution.height) {
		stateManager.commit('changeProjectResolution', { width: width.value, height: height.value });
	}
	if (timelineFps.value !== stateManager.state.timelineFps.value || !deepEqual(timelineMotionBlur.value, stateManager.state.timelineMotionBlur.value)) {
		stateManager.commit('changeTimelineRenderSettings', { timelineFps: timelineFps.value, timelineMotionBlur: timelineMotionBlur.value });
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
