<template>
<GsModal ref="modal" preferType="dialog" @opened="dialogContent?.focus()" @closed="emit('closed')" @esc="closeDialog" @click="closeDialog" @dragover.prevent.stop @drop.prevent.stop>
	<div ref="dialogContent" :class="$style.root" class="_gaps_s" tabindex="-1" @keydown.stop @keydown.esc.prevent="closeDialog">
		<div :class="$style.title">Export timeline</div>
		<div :inert="exporting">
			<GsTabs v-model="mode" :def="[{ id: 'video', label: 'Video' }, { id: 'still', label: 'Still image' }]"/>
		</div>
		<GsSelect v-if="mode === 'video'" v-model="videoFormat" :items="[{ value: 'mp4', label: 'MP4 (H.264)' }]" :disabled="exporting">
			<template #label>File format</template>
		</GsSelect>
		<GsSelect v-else v-model="stillFormat" :items="[{ value: 'webp', label: 'WebP' }]" :disabled="exporting">
			<template #label>File format</template>
		</GsSelect>
		<GsSelect v-model="quality" :items="qualityOptions" :disabled="exporting">
			<template #label>Quality</template>
		</GsSelect>
		<GsSelect v-model="resolutionScale" :items="resolutionOptions" :disabled="exporting">
			<template #label>Resolution</template>
			<template #caption>{{ resolution.width }} × {{ resolution.height }} px</template>
		</GsSelect>
		<GsInput v-if="mode === 'video'" v-model="fps" type="number" :min="1" :max="120" :step="'any'" :disabled="exporting"><template #label>Frame rate (fps)</template></GsInput>
		<div :class="$style.row">
			<GsInput v-model="startTime" placeholder="00:00:00.000" :disabled="exporting"><template #label>{{ mode === 'video' ? 'Start' : 'Time' }} (HH:MM:SS.mmm)</template></GsInput>
			<GsInput v-if="mode === 'video'" v-model="endTime" placeholder="00:00:00.000" :disabled="exporting"><template #label>End (HH:MM:SS.mmm)</template></GsInput>
		</div>
		<GsButton inline :disabled="exporting" @click="startTime = formatExportTime(currentTimelineTime)">Use current playhead</GsButton>
		<div>Estimated size: {{ estimatedSize }}</div>
		<div :class="$style.note">{{ mode === 'video' ? 'No audio or Player inputs. Transparent areas use a black background.' : 'No Player inputs. Transparency is preserved.' }}</div>
		<div v-if="validationError" :class="$style.error">{{ validationError }}</div>
		<div v-if="exporting" class="_gaps_s">
			<div :class="$style.progress"><div :class="$style.progressFill" :style="{ width: `${progressPercent}%` }"></div></div>
			<div>{{ progressText }}</div>
		</div>
		<div v-if="error" :class="$style.error">{{ error }}</div>
		<div v-if="status">{{ status }}</div>
		<a v-if="downloadUrl && !exporting" :href="downloadUrl" :download="downloadName">Download {{ downloadName }}</a>
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
import GsTabs from './common/GsTabs.vue';
import type { ExportProgress, ExportQuality, TimelineExportSettings } from '@/export/timeline-export.ts';
import { appContext, engine } from '@/app.ts';
import { exportTimeline } from '@/export/client.ts';
import { getTimelineEnd, validateExportSettings } from '@/export/timeline-export.ts';
import { estimateExportBytes, formatExportTime, parseExportTime, scaleExportResolution } from '@/export/export-settings.ts';
import { currentTimelineTime } from '@/timeline.ts';

const modal = useTemplateRef('modal');
const dialogContent = useTemplateRef('dialogContent');

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const mode = ref('video');
const videoFormat = ref<'mp4'>('mp4');
const stillFormat = ref<'webp'>('webp');
const videoQuality = ref<ExportQuality>('high');
const stillQuality = ref<ExportQuality | 'lossless'>('high');
const quality = computed({
	get: () => mode.value === 'video' ? videoQuality.value : stillQuality.value,
	set: (value: ExportQuality | 'lossless') => {
		if (mode.value === 'still') stillQuality.value = value;
		else if (value !== 'lossless') videoQuality.value = value;
	},
});
const qualityOptions = computed(() => [
	{ value: 'low', label: 'Low' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'high', label: 'High' },
	{ value: 'very-high', label: 'Very high' },
	...(mode.value === 'still' ? [{ value: 'lossless', label: 'Lossless' }] : []),
]);
const resolutionScale = ref(1);
const resolutionOptions = [0.25, 0.5, 1, 2, 4].map(value => ({ value, label: `${value}x` }));
const resolution = computed(() => scaleExportResolution(appContext.state.resolution.value, resolutionScale.value, mode.value === 'video' ? 'mp4' : 'webp'));
const fps = ref(60);
const startTime = ref('00:00:00.000');
const endTime = ref(formatExportTime(getTimelineEnd(appContext.state.timeline.value)));
const exporting = ref(false);
const error = ref('');
const status = ref('');
const progress = ref<ExportProgress>({ phase: 'preparing', completedFrames: 0, totalFrames: 0 });
const downloadUrl = ref('');
const downloadName = ref('');
let controller: AbortController | undefined;
const settings = computed<TimelineExportSettings>(() => {
	const common = { ...resolution.value, startTimeMs: parseExportTime(startTime.value) };
	return mode.value === 'still'
		? { ...common, format: 'webp', quality: stillQuality.value }
		: { ...common, format: 'mp4', quality: videoQuality.value, fps: fps.value, endTimeMs: parseExportTime(endTime.value) };
});
const validationError = computed(() => {
	if (mode.value === 'video' && !Number.isFinite(parseExportTime(endTime.value))) return 'Enter a valid end time (HH:MM:SS.mmm).';
	return validateExportSettings(settings.value);
});
const estimatedSize = computed(() => {
	if (validationError.value) return '—';
	const bytes = estimateExportBytes(settings.value);
	if (bytes < 1024 * 1024) return `≈ ${(bytes / 1024).toFixed(1)} KiB`;
	if (bytes < 1024 ** 3) return `≈ ${(bytes / 1024 ** 2).toFixed(1)} MiB`;
	return `≈ ${(bytes / 1024 ** 3).toFixed(2)} GiB`;
});
const progressPercent = computed(() => progress.value.totalFrames === 0 ? 0 : Math.min(99, progress.value.completedFrames / progress.value.totalFrames * 100));
const progressText = computed(() => {
	if (progress.value.phase === 'preparing') return 'Preparing…';
	if (progress.value.phase === 'finalizing') return mode.value === 'still' ? 'Encoding WebP…' : 'Finalizing MP4…';
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
		const exportSettings = { ...settings.value };
		// VueのProxyを外し、編集中の状態とWorkerの状態を独立させる。
		const buffer = await exportTimeline({
			settings: exportSettings,
			project: deepClone({
				assets: appContext.state.assets.value,
				visualModules: appContext.state.visualModules.value,
				timeline: appContext.state.timeline.value,
			}),
			renderer: engine.getExportRendererSettings(),
		}, signal, value => { progress.value = value; });
		signal.throwIfAborted();
		downloadName.value = `${appContext.projectName || 'timeline'}.${exportSettings.format}`;
		downloadUrl.value = URL.createObjectURL(new Blob([buffer], { type: exportSettings.format === 'mp4' ? 'video/mp4' : 'image/webp' }));
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
