<template>
<GsModal ref="modal" preferType="dialog" @opened="dialogContent?.focus()" @closed="emit('closed')" @esc="closeDialog" @click="closeDialog" @dragover.prevent.stop @drop.prevent.stop>
	<div ref="dialogContent" :class="$style.root" class="_gaps_m" tabindex="-1" @keydown.stop @keydown.esc.prevent="closeDialog">
		<div :class="$style.title">{{ i18n.ts._Export.Title }}</div>
		<GsSelect v-model="sceneId" large :items="sceneItems" :disabled="exporting"><template #label>{{ i18n.ts.Scene }}</template></GsSelect>
		<div :inert="exporting">
			<GsTabs v-model="mode" :def="[{ id: 'video', label: i18n.ts.Video }, { id: 'still', label: i18n.ts._Export.StillImage }]"/>
		</div>
		<GsSelect v-if="mode === 'video'" v-model="videoFormat" large :items="[{ value: 'mp4', label: 'MP4 (H.264)' }]" :disabled="exporting">
			<template #label>{{ i18n.ts._Export.FileFormat }}</template>
		</GsSelect>
		<GsSelect v-else v-model="stillFormat" large :items="[{ value: 'webp', label: 'WebP' }]" :disabled="exporting">
			<template #label>{{ i18n.ts._Export.FileFormat }}</template>
		</GsSelect>
		<GsSelect v-model="quality" large :items="qualityOptions" :disabled="exporting">
			<template #label>{{ i18n.ts._Export.Quality }}</template>
		</GsSelect>
		<GsSelect v-model="resolutionScale" large :items="scaleOptions" :disabled="exporting">
			<template #label>{{ i18n.ts.Resolution }}</template>
			<template #caption>{{ resolution.width }} × {{ resolution.height }} px</template>
		</GsSelect>
		<div v-if="resolutionScale === 'custom'" :class="$style.row">
			<GsInput v-model="customResolution.width" large type="number" :min="1" :max="8192" :step="1" :disabled="exporting"><template #label>{{ i18n.ts.Width }}</template><template #suffix>px</template></GsInput>
			<GsInput v-model="customResolution.height" large type="number" :min="1" :max="8192" :step="1" :disabled="exporting"><template #label>{{ i18n.ts.Height }}</template><template #suffix>px</template></GsInput>
		</div>
		<GsSelect v-if="mode === 'video'" v-model="fpsScale" large :items="scaleOptions" :disabled="exporting">
			<template #label>{{ i18n.ts._Export.FrameRate }}</template>
			<template #caption>{{ fps }} fps</template>
		</GsSelect>
		<GsInput v-if="mode === 'video' && fpsScale === 'custom'" v-model="customFps" large type="number" :min="1" :max="120" :step="'any'" :disabled="exporting"><template #label>{{ i18n.ts._Export.FrameRate }}</template><template #suffix>fps</template></GsInput>
		<div :class="$style.row">
			<GsInput v-model="startTime" large placeholder="00:00:00.000" :disabled="exporting"><template #label>{{ mode === 'video' ? i18n.ts._Export.StartTime : i18n.ts._Export.StillTime }}</template></GsInput>
			<GsInput v-if="mode === 'video'" v-model="endTime" large placeholder="00:00:00.000" :disabled="exporting"><template #label>{{ i18n.ts._Export.EndTime }}</template></GsInput>
		</div>
		<GsButton large inline :disabled="exporting || sceneId !== activeSceneId" @click="startTime = formatExportTime(currentTimelineTime)">{{ i18n.ts._Export.UseCurrentPlayhead }}</GsButton>
		<div>{{ i18n.ts._Export.EstimatedSize }}: {{ estimatedSize }}</div>
		<div v-if="validationError" :class="$style.error">{{ validationError }}</div>
		<div v-if="exporting && !choosingSaveFile" class="_gaps_m">
			<div :class="$style.progress"><div :class="$style.progressFill" :style="{ width: `${progressPercent}%` }"></div></div>
			<div>{{ progressText }}<GsEllipsis/></div>
		</div>
		<div v-if="error" :class="$style.error">{{ error }}</div>
		<div v-if="status">{{ status }}</div>
		<a v-if="downloadUrl && !exporting" :href="downloadUrl" :download="downloadName">{{ i18n.tsx._Export.DownloadFile({ name: downloadName }) }}</a>
		<div :class="$style.actions">
			<GsButton large inline :disabled="choosingSaveFile || savingFile" @click="cancel">{{ exporting ? i18n.ts._Export.Cancel : i18n.ts.Close }}</GsButton>
			<GsButton large inline primary :disabled="exporting || validationError != null" @click="doExport">{{ i18n.ts._Export.Export }}</GsButton>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, reactive, ref, toRefs, watch, useTemplateRef } from 'vue';
import { getSceneDuration } from '@gs/subsystems_timeline_shared/scenes.ts';
import { getSceneBaseResolution } from '@gs/subsystems_timeline_shared/scene-resolution.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { getRequiredVoicevoxRequestsForRendering } from '@gs/subsystems_timeline_shared/voicevox-requests.ts';
import { getRendererAssets } from '../utility/renderer-assets.ts';
import GsModal from './common/GsModal.vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import GsTabs from './common/GsTabs.vue';
import GsEllipsis from './common/GsEllipsis.vue';
import type { ExportProgress, ExportQuality, TimelineExportSettings } from '@/export/timeline-export.ts';
import { preferences } from '@/preferences.ts';
import { appContext } from '@/app.ts';
import { applicationActivity } from '@/application-activity.ts';
import { exportTimeline } from '@/export/client.ts';
import { validateExportSettings } from '@/export/timeline-export.ts';
import { adjustExportResolution, createDefaultExportDialogSettings, estimateExportBytes, formatExportTime, parseExportTime, scaleExportResolution } from '@/export/export-settings.ts';
import { hasExportAudio, MP4_AUDIO_BITRATE } from '@/export/audio-export-settings.ts';
import { i18n } from '@/i18n.ts';

const { activeSceneId, previewPlayback } = appContext;
const { stateManager } = appContext.projectContext;
const { name: projectName } = appContext.projectContext.stateManager.state;

const currentTimelineTime = previewPlayback.currentTimelineTime;

const modal = useTemplateRef('modal');
const dialogContent = useTemplateRef('dialogContent');

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const projectGeneration = appContext.projectContext.generation;
const savedSettings = stateManager.state.exportSettings.value;
const firstScene = stateManager.state.timelineScenes.value[0] ?? null;
const initialScene = (previewPlayback.state.value.mode === 'timeline'
	? stateManager.state.timelineScenes.value.find(scene => scene.id === appContext.activeScene.value?.id)
	: null) ?? firstScene;
const initialSceneId = initialScene?.id ?? '';
const dialogSettings = reactive(deepClone(savedSettings ?? createDefaultExportDialogSettings(initialSceneId,
	getSceneBaseResolution(initialScene?.resolution ?? { mode: 'project' }, stateManager.state.resolution.value),
	stateManager.state.timelineFps.value, initialScene == null ? 0 : getSceneDuration(initialScene))));
// 未選択なら先頭のSceneを使い、削除済みの参照は現在のSceneへ戻す。
// どちらも以前の時間範囲を流用せず、選択したSceneの全範囲から始める。
if (!stateManager.state.timelineScenes.value.some(scene => scene.id === dialogSettings.sceneId)) {
	const fallbackScene = dialogSettings.sceneId === '' ? firstScene : initialScene;
	dialogSettings.sceneId = fallbackScene?.id ?? '';
	dialogSettings.startTime = formatExportTime(0);
	dialogSettings.endTime = formatExportTime(fallbackScene == null ? 0 : getSceneDuration(fallbackScene));
}
const { sceneId, mode, videoFormat, stillFormat, videoQuality, stillQuality, resolutionScale, customResolution,
								fpsScale, customFps, startTime, endTime } = toRefs(dialogSettings);
const sceneItems = computed(() => [{ label: i18n.ts._Export.ChooseScene, value: '' }, ...stateManager.state.timelineScenes.value.map(scene => ({ label: scene.name, value: scene.id }))]);
const scene = computed(() => stateManager.state.timelineScenes.value.find(scene => scene.id === sceneId.value));
const quality = computed({
	get: () => mode.value === 'video' ? videoQuality.value : stillQuality.value,
	set: (value: ExportQuality | 'lossless') => {
		if (mode.value === 'still') stillQuality.value = value;
		else if (value !== 'lossless') videoQuality.value = value;
	},
});
const qualityOptions = computed(() => [
	{ value: 'low', label: i18n.ts._Export.Low },
	{ value: 'medium', label: i18n.ts._Export.Medium },
	{ value: 'high', label: i18n.ts._Export.High },
	{ value: 'very-high', label: i18n.ts._Export.VeryHigh },
	...(mode.value === 'still' ? [{ value: 'lossless', label: i18n.ts._Export.Lossless }] : []),
]);
const scaleOptions = [...[0.25, 0.5, 1, 2, 4].map(value => ({ value, label: `${value}x` })), { value: 'custom', label: i18n.ts._Export.Custom }];
const resolution = computed(() => resolutionScale.value === 'custom'
	? adjustExportResolution(customResolution.value, mode.value === 'video' ? 'mp4' : 'webp')
	: scaleExportResolution(getSceneBaseResolution(scene.value?.resolution ?? { mode: 'project' },
		stateManager.state.resolution.value), resolutionScale.value, mode.value === 'video' ? 'mp4' : 'webp'));
const fps = computed(() => fpsScale.value === 'custom' ? customFps.value : stateManager.state.timelineFps.value * fpsScale.value);
watch(sceneId, () => { startTime.value = formatExportTime(0); endTime.value = formatExportTime(scene.value == null ? 0 : getSceneDuration(scene.value)); });
const exporting = ref(false);
const choosingSaveFile = ref(false);
const savingFile = ref(false);
const error = ref('');
const status = ref('');
const progress = ref<ExportProgress>({ phase: 'preparing', completedFrames: 0, totalFrames: 0 });
const downloadUrl = ref('');
const downloadName = ref('');
let abortController: AbortController | null = null;
const settings = computed<TimelineExportSettings>(() => {
	const common = { ...resolution.value, positionMs: parseExportTime(startTime.value) };
	return mode.value === 'still'
		? { ...common, format: 'webp', quality: stillQuality.value }
		: {
			...common,
			format: 'mp4',
			quality: videoQuality.value,
			fps: fps.value,
			endTimeMs: parseExportTime(endTime.value),
		};
});
const validationError = computed(() => {
	if (appContext.renderValidation.errorMessage.value) return appContext.renderValidation.errorMessage.value;
	if (scene.value == null) return i18n.ts._Export.NoScene;
	if (getSceneDuration(scene.value) <= 0) return i18n.ts._Export.EmptyScene;
	if (mode.value === 'video' && !Number.isFinite(parseExportTime(endTime.value))) return i18n.ts._Export.InvalidEndTime;
	return validateExportSettings(settings.value);
});
const includesAudio = computed(() => !appContext.renderValidation.errorMessage.value && scene.value != null && hasExportAudio(stateManager.state.timelineScenes.value, sceneId.value, settings.value, stateManager.state.generatedSpeech.value));
const estimatedSize = computed(() => {
	if (validationError.value) return '—';
	const bytes = estimateExportBytes(settings.value, includesAudio.value ? MP4_AUDIO_BITRATE : 0);
	if (bytes < 1024 * 1024) return `≈ ${(bytes / 1024).toFixed(1)} KiB`;
	if (bytes < 1024 ** 3) return `≈ ${(bytes / 1024 ** 2).toFixed(1)} MiB`;
	return `≈ ${(bytes / 1024 ** 3).toFixed(2)} GiB`;
});
const progressPercent = computed(() => progress.value.totalFrames === 0 ? 0 : Math.min(99, progress.value.completedFrames / progress.value.totalFrames * 100));
const progressText = computed(() => {
	if (savingFile.value) return i18n.ts._Export.Saving;
	if (progress.value.phase === 'preparing') return i18n.ts._Export.Preparing;
	if (progress.value.phase === 'finalizing') return mode.value === 'still' ? i18n.ts._Export.EncodingWebp : i18n.ts._Export.FinalizingMp4;
	return i18n.tsx._Export.RenderingFrames({ completed: progress.value.completedFrames, total: progress.value.totalFrames, percent: Math.floor(progressPercent.value) });
});

function saveExportSettings() {
	// 読込で別プロジェクトへ切り替わった後に、旧ダイアログの設定を保存しない。
	if (appContext.projectContext.generation !== projectGeneration) return;
	if (!deepEqual(dialogSettings, stateManager.state.exportSettings.value)) {
		stateManager.commit('changeExportSettings', dialogSettings);
	}
}

function closeDialog() {
	if (exporting.value) return;
	saveExportSettings();
	modal.value?.close();
}

function cancel() {
	if (exporting.value) abortController?.abort();
	else closeDialog();
}

function setTaskbarProgress(value: number | null) {
	// OS側の表示に失敗しても、エクスポート自体は継続する。
	void window.desktop?.setProgressBar(value).catch(console.error);
}

async function doExport() {
	if (exporting.value || validationError.value) return;
	saveExportSettings();
	const releaseActivity = applicationActivity.acquire();
	// 無効化するEXPORTボタンからフォーカスを移し、背後の編集ショートカットへイベントを流さない。
	dialogContent.value?.focus();
	exporting.value = true;
	error.value = '';
	status.value = '';
	progress.value = { phase: 'preparing', completedFrames: 0, totalFrames: 0 };
	abortController = new AbortController();
	const signal = abortController.signal;
	const desktop = window.desktop;
	let exportSaveFile: { id: string; name: string } | null = null;
	let previewDisposed = false;
	try {
		const exportSettings = { ...settings.value };
		const exportResolutionScale = resolutionScale.value === 'custom' ? null : resolutionScale.value;
		const exportSceneId = sceneId.value;
		const suggestedName = `${projectName.value || 'project'}-${scene.value?.name || 'scene'}.${exportSettings.format}`;
		if (desktop != null) {
			// 保存先の確定前に、音声生成・プレビュー停止・Workerでの描画を開始しない。
			choosingSaveFile.value = true;
			exportSaveFile = await desktop.chooseExportSaveFile(suggestedName, exportSettings.format);
			choosingSaveFile.value = false;
			if (exportSaveFile == null) return;
		}
		signal.throwIfAborted();
		if (downloadUrl.value) URL.revokeObjectURL(downloadUrl.value);
		downloadUrl.value = '';
		downloadName.value = exportSaveFile?.name ?? suggestedName;
		// 準備やエンコードは残り時間を計算できないため、Windowsでは処理中表示にする。
		setTaskbarProgress(2);
		const exportProject = deepClone({
			resolution: stateManager.state.resolution.value,
			timelineFps: stateManager.state.timelineFps.value,
			timelineMotionBlur: stateManager.state.timelineMotionBlur.value,
			assets: getRendererAssets(stateManager.state.assets.value),
			generatedSpeech: stateManager.state.generatedSpeech.value,
			visualModules: stateManager.state.visualModules.value,
			timelineScenes: stateManager.state.timelineScenes.value,
			sceneId: exportSceneId,
		});
		if (exportSettings.format === 'mp4') {
			status.value = `${i18n.ts._Export.PreparingVoicevox}...`;
			const requests = getRequiredVoicevoxRequestsForRendering(exportProject.timelineScenes, exportProject.sceneId, exportSettings.positionMs, exportSettings.endTimeMs);
			const preparedSpeech = await appContext.voicevoxGeneration.prepare(requests, signal);
			// 描画用の音声参照でも使えるよう、開始時点の生成済み音声を残して準備結果を加える。
			// 待機中の編集や再生成を混ぜず、この書き出しが保持した結果だけをWorkerへ渡す。
			exportProject.generatedSpeech = [...new Map([...exportProject.generatedSpeech, ...preparedSpeech].map(speech => [speech.key, speech])).values()];
			status.value = '';
		}
		signal.throwIfAborted();
		const preferredFormat = navigator.gpu.getPreferredCanvasFormat();
		// エクスポート中はリソース節約のためプレビュー用レンダラーは破棄
		await appContext.suspendPreview();
		previewDisposed = true;
		// VueのProxyを外し、編集中の状態とWorkerの状態を独立させる。
		const buffer = await exportTimeline({
			settings: exportSettings,
			resolutionScale: exportResolutionScale,
			project: deepClone(exportProject),
			// 書き出し開始時の環境設定から独立した設定を作る。
			// プレビュー用Controllerの初期化・再読み込み状態には依存しない。
			renderer: {
				enable32bitDataTextures: preferences.s.enable32bitDataTextures,
				intermediateTextureFormat: preferences.s.intermediateTextureFormat
					?? (preferredFormat === 'bgra8unorm' ? 'bgra8unorm' : 'rgba8unorm'),
			},
		}, signal, value => {
			progress.value = value;
			setTaskbarProgress(value.phase === 'rendering' && value.totalFrames > 0
				? Math.min(0.99, value.completedFrames / value.totalFrames)
				: 2);
		});
		signal.throwIfAborted();
		if (desktop != null && exportSaveFile != null) {
			savingFile.value = true;
			setTaskbarProgress(2);
			await desktop.writeExportFile(exportSaveFile.id, new Uint8Array(buffer));
		} else {
			downloadUrl.value = URL.createObjectURL(new Blob([buffer], { type: exportSettings.format === 'mp4' ? 'video/mp4' : 'image/webp' }));
			const link = window.document.createElement('a');
			link.href = downloadUrl.value;
			link.download = downloadName.value;
			link.click();
		}
		status.value = i18n.ts._Export.Complete;
		// Electron版では保存の成功後に通知し、通知の失敗をエクスポート失敗として扱わない。
		void desktop?.notifyExportComplete(downloadName.value).catch(console.error);
	} catch (cause) {
		if (signal.aborted) status.value = i18n.ts._Export.Canceled;
		else error.value = cause instanceof Error ? cause.message : String(cause);
	} finally {
		if (exportSaveFile != null) void desktop?.releaseExportFile(exportSaveFile.id).catch(console.error);
		choosingSaveFile.value = false;
		savingFile.value = false;
		setTaskbarProgress(null);
		// 再初期化が終わるまで操作を戻さず、次の書き出しによる初期化の中断を防ぐ。
		try {
			if (previewDisposed) await appContext.resumePreview();
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : String(cause);
			error.value = [error.value, i18n.tsx._Export.PreviewRestartFailed({ message })].filter(Boolean).join('\n');
		}
		exporting.value = false;
		abortController = null;
		releaseActivity();
	}
}

onBeforeUnmount(() => {
	saveExportSettings();
	abortController?.abort();
	if (exporting.value) setTaskbarProgress(null);
	if (downloadUrl.value) URL.revokeObjectURL(downloadUrl.value);
});
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

.title {
	font-size: 1.2em;
	font-weight: bold;
}
.row {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 16px;
}
.error {
	color: var(--THEME-error);
}
.actions {
	display: flex;
	justify-content: flex-end;
	gap: 12px;
}
.progress {
	height: 6px;
	background: var(--THEME-panel);
	border-radius: 3px;
	overflow: clip;
}
.progressFill {
	height: 100%;
	background: var(--THEME-accent);
	transition: width 0.1s linear;
}
</style>
