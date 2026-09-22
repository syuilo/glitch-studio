<template>
<GsModal ref="modal" preferType="dialog" @opened="dialogContent?.focus()" @closed="emit('closed')" @esc="closeDialog" @click="closeDialog" @dragover.prevent.stop @drop.prevent.stop>
	<div ref="dialogContent" :class="$style.root" class="_gaps" tabindex="-1" @keydown.stop @keydown.esc.prevent="closeDialog">
		<div :class="$style.title">Export timeline</div>
		<GsSelect v-model="format" :items="[{ value: 'mp4', label: 'MP4 (H.264)' }]" :disabled="exporting">
			<template #label>File format</template>
			<template #caption>Animated WebP will be available in a later update.</template>
		</GsSelect>
		<GsSelect v-model="quality" :items="qualityOptions" :disabled="exporting">
			<template #label>Quality</template>
		</GsSelect>
		<div :class="$style.row">
			<GsInput v-model="width" type="number" :min="2" :max="8192" :step="2" :disabled="exporting"><template #label>Width (px)</template></GsInput>
			<GsInput v-model="height" type="number" :min="2" :max="8192" :step="2" :disabled="exporting"><template #label>Height (px)</template></GsInput>
		</div>
		<GsInput v-model="fps" type="number" :min="1" :max="120" :step="'any'" :disabled="exporting"><template #label>Frame rate (fps)</template></GsInput>
		<div :class="$style.row">
			<GsInput v-model="startSeconds" type="number" :min="0" :step="'any'" :disabled="exporting"><template #label>Start (seconds)</template></GsInput>
			<GsInput v-model="endSeconds" type="number" :min="0" :step="'any'" :disabled="exporting"><template #label>End (seconds)</template></GsInput>
		</div>
		<div :class="$style.note">No audio or Player inputs. Transparent areas use a black background.</div>
		<div v-if="validationError" :class="$style.error">{{ validationError }}</div>
		<div v-if="exporting" class="_gaps_s">
			<div :class="$style.progress"><div :class="$style.progressFill" :style="{ width: `${progressPercent}%` }"></div></div>
			<div>{{ progressText }}</div>
		</div>
		<div v-if="error" :class="$style.error">{{ error }}</div>
		<div v-if="status">{{ status }}</div>
		<a v-if="downloadUrl && !exporting" :href="downloadUrl" :download="downloadName">Download MP4</a>
		<div :class="$style.actions">
			<GsButton inline @click="cancel">{{ exporting ? 'Cancel export' : 'Close' }}</GsButton>
			<GsButton inline primary :disabled="exporting || validationError != null" @click="doExport">EXPORT</GsButton>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import GsModal from './common/GsModal.vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import type { ExportProgress, TimelineExportSettings } from '@/export/timeline-export.ts';
import { appContext, engine } from '@/app.ts';
import { exportTimeline } from '@/export/client.ts';
import { getTimelineEnd, validateExportSettings } from '@/export/timeline-export.ts';

const modal = useTemplateRef('modal');
const dialogContent = useTemplateRef('dialogContent');

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const format = ref<'mp4'>('mp4');
const quality = ref<TimelineExportSettings['quality']>('high');
const qualityOptions = [
	{ value: 'low', label: 'Low' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'high', label: 'High' },
	{ value: 'very-high', label: 'Very high' },
];
const width = ref(appContext.state.resolution.value.width);
const height = ref(appContext.state.resolution.value.height);
const fps = ref(60);
const startSeconds = ref(0);
const endSeconds = ref(getTimelineEnd(appContext.state.timeline.value) / 1000);
const exporting = ref(false);
const error = ref('');
const status = ref('');
const progress = ref<ExportProgress>({ phase: 'preparing', completedFrames: 0, totalFrames: 0 });
const downloadUrl = ref('');
const downloadName = ref('');
let controller: AbortController | undefined;
const settings = computed<TimelineExportSettings>(() => ({
	format: format.value,
	quality: quality.value,
	width: width.value,
	height: height.value,
	fps: fps.value,
	startTimeMs: startSeconds.value * 1000,
	endTimeMs: endSeconds.value * 1000,
}));
const validationError = computed(() => validateExportSettings(settings.value));
const progressPercent = computed(() => progress.value.totalFrames === 0 ? 0 : Math.min(99, progress.value.completedFrames / progress.value.totalFrames * 100));
const progressText = computed(() => {
	if (progress.value.phase === 'preparing') return 'Preparing…';
	if (progress.value.phase === 'finalizing') return 'Finalizing MP4…';
	return `Rendering ${progress.value.completedFrames} / ${progress.value.totalFrames} frames (${Math.floor(progressPercent.value)}%)`;
});

function closeDialog() {
	if (!exporting.value) modal.value?.close();
}

function cancel() {
	if (exporting.value) controller?.abort();
	else closeDialog();
}

async function doExport() {
	if (exporting.value || validationError.value) return;
	// 無効化するEXPORTボタンからフォーカスを移し、背後の編集ショートカットへイベントを流さない。
	dialogContent.value?.focus();
	exporting.value = true;
	error.value = '';
	status.value = '';
	progress.value = { phase: 'preparing', completedFrames: 0, totalFrames: 0 };
	controller = new AbortController();
	const signal = controller.signal;
	if (downloadUrl.value) URL.revokeObjectURL(downloadUrl.value);
	downloadUrl.value = '';
	try {
		// VueのProxyを外し、編集中の状態とWorkerの状態を独立させる。
		const buffer = await exportTimeline({
			settings: { ...settings.value },
			project: deepClone({
				assets: appContext.state.assets.value,
				visualModules: appContext.state.visualModules.value,
				timeline: appContext.state.timeline.value,
			}),
			renderer: engine.getExportRendererSettings(),
		}, signal, value => { progress.value = value; });
		signal.throwIfAborted();
		downloadName.value = `${appContext.projectName || 'timeline'}.mp4`;
		downloadUrl.value = URL.createObjectURL(new Blob([buffer], { type: 'video/mp4' }));
		const link = window.document.createElement('a');
		link.href = downloadUrl.value;
		link.download = downloadName.value;
		link.click();
		status.value = 'Export complete.';
	} catch (cause) {
		if (signal.aborted) status.value = 'Export canceled.';
		else error.value = cause instanceof Error ? cause.message : String(cause);
	} finally {
		exporting.value = false;
		controller = undefined;
	}
}

onBeforeUnmount(() => {
	controller?.abort();
	if (downloadUrl.value) URL.revokeObjectURL(downloadUrl.value);
});
</script>

<style module lang="scss">
.root {
	margin: auto;
	position: relative;
	padding: 32px;
	width: 480px;
	max-width: 90vw;
	max-height: 90vh;
	overflow-y: auto;
	box-sizing: border-box;
	background: var(--THEME-dialog);
	border-radius: 10px;
}

.title { font-size: 1.2em; font-weight: bold; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.note { opacity: 0.7; font-size: 0.9em; }
.error { color: var(--THEME-error); }
.actions { display: flex; justify-content: flex-end; gap: 12px; }
.progress { height: 6px; background: var(--THEME-panel); border-radius: 3px; overflow: hidden; }
.progressFill { height: 100%; background: var(--THEME-accent); transition: width 0.1s linear; }
</style>
