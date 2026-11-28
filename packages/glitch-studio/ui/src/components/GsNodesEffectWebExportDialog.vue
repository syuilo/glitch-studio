<template>
<GsModal ref="modal" preferType="dialog" @closed="emit('closed')" @esc="closeDialog" @click="closeDialog">
	<div class="_gaps_m" :class="$style.root" data-test-nodes-effect-web-export>
		<div>{{ i18n.ts._NodesEffect.WebExport }}</div>
		<GsSelect
			v-model="format"
			large
			:items="formats"
			:disabled="exporting"
			data-test-web-export-format
		>
			<template #label>{{ i18n.ts._NodesEffect.WebExportFormat }}</template>
		</GsSelect>
		<GsInput
			v-model="resolutionScale"
			type="number"
			large
			:min="0.01"
			:step="0.1"
			:disabled="exporting"
			data-test-web-export-scale
		>
			<template #label>{{ i18n.ts._NodesEffect.WebExportScale }}</template>
		</GsInput>
		<GsSelect
			v-model="fpsMode"
			large
			:items="fpsModes"
			:disabled="exporting"
			data-test-web-export-fps-mode
		>
			<template #label>{{ i18n.ts._NodesEffect.WebExportFps }}</template>
		</GsSelect>
		<GsInput
			v-if="fpsMode === 'custom'"
			v-model="customFpsLimit"
			type="number"
			large
			:min="1"
			:step="1"
			:disabled="exporting"
			data-test-web-export-fps-limit
		>
			<template #label>{{ i18n.ts._Export.FrameRate }}</template>
		</GsInput>
		<GsTextarea v-model="initialParameters" code large :disabled="exporting" data-test-web-export-parameters>
			<template #label>{{ i18n.ts._NodesEffect.WebExportParameters }}</template>
		</GsTextarea>
		<div v-if="validationError != null || exportError != null" data-test-web-export-error>{{ validationError ?? exportError }}</div>
		<div v-if="status !== null" data-test-web-export-status>{{ status }}</div>
		<div :class="$style.actions">
			<GsButton inline large :disabled="committing" @click="closeDialog">{{ i18n.ts.Cancel }}</GsButton>
			<GsButton
				inline
				large
				primary
				:disabled="validationError != null || exporting"
				:wait="exporting"
				data-test-web-export-download
				@click="download"
			>
				{{ i18n.ts._NodesEffect.Export }}
			</GsButton>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { computed, ref, useTemplateRef, onBeforeUnmount } from 'vue';
import { createPortableNodesEffectFiles, encodePortableNodesEffect } from '@gs/glitch-studio_embed/export.ts';
import { createPortableNodesEffectArchive } from '@gs/glitch-studio_embed/archive.ts';
import { validatePortableNodesEffectSettings } from '@gs/glitch-studio_shared/portable-nodes-effect.ts';
import GsModal from './common/GsModal.vue';
import GsSelect from './common/GsSelect.vue';
import GsInput from './common/GsInput.vue';
import GsTextarea from './common/GsTextarea.vue';
import GsButton from './common/GsButton.vue';
import type { preparePortableNodesEffect } from '@gs/glitch-studio_embed/export.ts';
import { applicationActivity } from '@/application-activity.ts';
import { i18n } from '@/i18n.ts';
import { parseNodesEffectWebExportParameters } from '@/utility/nodes-effect-web-export-parameters.ts';

const props = defineProps<{ prepared: ReturnType<typeof preparePortableNodesEffect> }>();
const emit = defineEmits<{ closed: [] }>();
const modal = useTemplateRef('modal');
const format = ref<'html' | 'zip'>('zip');
const formats = [
	{ value: 'zip', label: i18n.ts._NodesEffect.WebExportZip },
	{ value: 'html', label: i18n.ts._NodesEffect.WebExportHtml },
];
// 開いた時点の設定を編集する。外側のプロジェクト編集には追従させない。
const resolutionScale = ref(props.prepared.settings.resolutionScale);
const fpsMode = ref<'auto' | 'custom'>(props.prepared.settings.fpsLimit == null ? 'auto' : 'custom');
const customFpsLimit = ref(props.prepared.settings.fpsLimit ?? 60);
const fpsModes = [
	{ value: 'auto', label: i18n.ts.Auto },
	{ value: 'custom', label: i18n.ts._Export.Custom },
];
const initialParameters = ref(JSON.stringify(props.prepared.initialParameters, null, 2));
const exporting = ref(false);
const status = ref<string | null>(null);
const committing = ref(false);
let activeExport: AbortController | null = null;
let buildRequestId: string | null = null;

function cancelExport() {
	activeExport?.abort();
	if (buildRequestId != null) void window.desktop?.cancelPortableNodesEffect(buildRequestId).catch(() => {});
}

onBeforeUnmount(cancelExport);
const exportError = ref<string | null>(null);
const settings = computed(() => ({
	resolutionScale: resolutionScale.value,
	fpsLimit: fpsMode.value === 'auto' ? null : customFpsLimit.value,
}));
const validationError = computed(() => {
	try {
		validatePortableNodesEffectSettings(settings.value);
		parseNodesEffectWebExportParameters(props.prepared.nodesEffect, initialParameters.value);
		return null;
	} catch (error) { return error instanceof Error ? error.message : String(error); }
});

function closeDialog() {
	if (committing.value) return;
	if (exporting.value) { cancelExport(); return; }
	modal.value?.close();
}

async function download() {
	if (exporting.value) return;
	exportError.value = null;
	if (validationError.value != null) return;
	const desktop = window.desktop;
	if (!__ELECTRON__ || desktop == null) { exportError.value = i18n.ts._NodesEffect.WebExportDesktopOnly; return; }
	exporting.value = true;
	const controller = new AbortController();
	activeExport = controller;
	const { signal } = controller;
	let releaseActivity: (() => void) | null = null;
	let saveFile: { id: string; name: string } | null = null;
	try {
		releaseActivity = applicationActivity.acquireExport();
		const snapshot = {
			...props.prepared,
			settings: { ...settings.value },
			initialParameters: parseNodesEffectWebExportParameters(props.prepared.nodesEffect, initialParameters.value),
		};
		const selectedFormat = format.value;
		saveFile = await desktop.chooseExportSaveFile(`${snapshot.name}.${selectedFormat}`, selectedFormat);
		signal.throwIfAborted();
		if (saveFile == null) return;
		status.value = i18n.ts._NodesEffect.WebExportPreparing;
		const artwork = await encodePortableNodesEffect(snapshot, selectedFormat, signal);
		signal.throwIfAborted();
		status.value = i18n.ts._NodesEffect.WebExportBuilding;
		buildRequestId = crypto.randomUUID();
		// VueのProxyをIPCへ渡さず、検証した作品と同じ機能集合を値として送る。
		const runtime = await desktop.buildPortableNodesEffect(buildRequestId, {
			...snapshot.runtimeRequirements, effectIds: [...snapshot.runtimeRequirements.effectIds],
			parameterFeatures: [...snapshot.runtimeRequirements.parameterFeatures],
		});
		buildRequestId = null;
		signal.throwIfAborted();
		const files = createPortableNodesEffectFiles(artwork, runtime);
		const blob = files.format === 'html' ? new Blob([files.html], { type: 'text/html;charset=utf-8' }) : await createPortableNodesEffectArchive(files, signal);
		status.value = i18n.ts._NodesEffect.WebExportSaving;
		await desktop.beginExportFile(saveFile.id, blob.size);
		// 既存の保存セッションを使い、キャンセル時には以前のファイルを保持する。
		const chunkSize = 4 * 1024 * 1024;
		for (let offset = 0; offset < blob.size; offset += chunkSize) {
			signal.throwIfAborted();
			const chunk = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
			signal.throwIfAborted();
			await desktop.appendExportFile(saveFile.id, chunk);
		}
		signal.throwIfAborted();
		// 完成ファイルを置き換える短い区間では、キャンセルを受け付けない。
		committing.value = true;
		await desktop.finishExportFile(saveFile.id);
		modal.value?.close();
	} catch (error) {
		if (!signal.aborted) exportError.value = error instanceof Error ? error.message : String(error);
	} finally {
		try { if (saveFile != null) await desktop.releaseExportFile(saveFile.id); } finally {
			buildRequestId = null;
			activeExport = null;
			status.value = null;
			committing.value = false;
			exporting.value = false;
			releaseActivity?.();
		}
	}
}

</script>

<style module lang="scss">
.root {
	width: 480px;
	max-width: 85vw;
	max-height: 85vh;
	overflow: auto;
	padding: 24px;
	background: var(--THEME-dialog);
	border-radius: 12px;
}
.actions {
	display: flex;
	justify-content: flex-end;
	gap: 12px;
}
</style>
