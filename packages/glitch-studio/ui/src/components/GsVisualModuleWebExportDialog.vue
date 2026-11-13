<template>
<GsModal ref="modal" preferType="dialog" @closed="emit('closed')" @esc="closeDialog" @click="closeDialog">
	<div class="_gaps_m" :class="$style.root" data-test-visual-module-web-export>
		<div>{{ i18n.ts._VisualModule.WebExport }}</div>
		<GsSelect
			v-model="format"
			large
			:items="formats"
			:disabled="exporting"
			data-test-web-export-format
		>
			<template #label>{{ i18n.ts._VisualModule.WebExportFormat }}</template>
		</GsSelect>
		<div>{{ i18n.ts._VisualModule.WebExportHint }}</div>
		<div v-if="prepared.diagnostics.players.length > 0" data-test-web-export-players>{{ i18n.tsx._VisualModule.WebExportPlayers({ names: prepared.diagnostics.players.join(', ') }) }}</div>
		<div v-if="prepared.diagnostics.resolutionNodes.length > 0">{{ i18n.ts._VisualModule.WebExportResolutionHint }}</div>
		<GsInput
			v-model="resolutionScale"
			type="number"
			large
			:min="0.01"
			:step="0.1"
			:disabled="exporting"
			data-test-web-export-scale
		>
			<template #label>{{ i18n.ts._VisualModule.WebExportScale }}</template>
		</GsInput>
		<GsInput
			v-model="maxPixels"
			type="number"
			large
			:min="1"
			:step="1"
			:disabled="exporting"
		>
			<template #label>{{ i18n.ts._VisualModule.WebExportMaxPixels }}</template>
		</GsInput>
		<GsSelect
			v-model="fpsMode"
			large
			:items="fpsModes"
			:disabled="exporting"
			data-test-web-export-fps-mode
		>
			<template #label>{{ i18n.ts._VisualModule.WebExportFps }}</template>
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
			<template #label>{{ i18n.ts._VisualModule.WebExportParameters }}</template>
			<template #caption>{{ i18n.ts._VisualModule.WebExportParametersHint }}</template>
		</GsTextarea>
		<div v-if="validationError != null || exportError != null" data-test-web-export-error>{{ validationError ?? exportError }}</div>
		<div :class="$style.actions">
			<GsButton inline large :disabled="exporting" @click="closeDialog">{{ i18n.ts.Cancel }}</GsButton>
			<GsButton
				inline
				large
				primary
				:disabled="validationError != null || exporting"
				:wait="exporting"
				data-test-web-export-download
				@click="download"
			>
				{{ i18n.ts._VisualModule.Export }}
			</GsButton>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { computed, ref, useTemplateRef, onBeforeUnmount } from 'vue';
import { createPortableVisualModuleFiles, encodePortableVisualModule } from '@gs/glitch-studio_embed/export.ts';
import { createPortableVisualModuleArchive } from '@gs/glitch-studio_embed/archive.ts';
import { validatePortableParameters } from '@gs/glitch-studio_embed/parameters.ts';
import { validatePortableVisualModuleSettings } from '@gs/glitch-studio_shared/portable-visual-module.ts';
import GsModal from './common/GsModal.vue';
import GsSelect from './common/GsSelect.vue';
import GsInput from './common/GsInput.vue';
import GsTextarea from './common/GsTextarea.vue';
import GsButton from './common/GsButton.vue';
import type { preparePortableVisualModule } from '@gs/glitch-studio_embed/export.ts';
import { applicationActivity } from '@/application-activity.ts';
import { i18n } from '@/i18n.ts';

const props = defineProps<{ prepared: ReturnType<typeof preparePortableVisualModule> }>();
const emit = defineEmits<{ closed: [] }>();
const modal = useTemplateRef('modal');
const format = ref<'html' | 'zip'>('zip');
const formats = [
	{ value: 'zip', label: i18n.ts._VisualModule.WebExportZip },
	{ value: 'html', label: i18n.ts._VisualModule.WebExportHtml },
];
// 開いた時点の設定を編集する。外側のプロジェクト編集には追従させない。
const resolutionScale = ref(props.prepared.settings.resolutionScale);
const maxPixels = ref(props.prepared.settings.maxPixels);
const fpsMode = ref<'auto' | 'custom'>(props.prepared.settings.fpsLimit == null ? 'auto' : 'custom');
const customFpsLimit = ref(props.prepared.settings.fpsLimit ?? 60);
const fpsModes = [
	{ value: 'auto', label: i18n.ts.Auto },
	{ value: 'custom', label: i18n.ts._Export.Custom },
];
const initialParameters = ref(JSON.stringify(props.prepared.initialParameters, null, 2));
const exporting = ref(false);
const lifetime = new AbortController();
onBeforeUnmount(() => { lifetime.abort(); });
const exportError = ref<string | null>(null);
const settings = computed(() => ({
	resolutionScale: resolutionScale.value,
	maxPixels: maxPixels.value,
	fpsLimit: fpsMode.value === 'auto' ? null : customFpsLimit.value,
}));
const validationError = computed(() => {
	try {
		validatePortableVisualModuleSettings(settings.value);
		validatePortableParameters(props.prepared.visualModule.paramDefs, JSON.parse(initialParameters.value));
		return null;
	} catch (error) { return error instanceof Error ? error.message : String(error); }
});

function closeDialog() { if (!exporting.value) modal.value?.close(); }

async function download() {
	if (exporting.value) return;
	exportError.value = null;
	if (validationError.value != null) return;
	exporting.value = true;
	let releaseActivity: (() => void) | null = null;
	try {
		releaseActivity = applicationActivity.acquireExport();
		const snapshot = {
			...props.prepared,
			settings: { ...settings.value },
			initialParameters: validatePortableParameters(props.prepared.visualModule.paramDefs, JSON.parse(initialParameters.value)),
		};
		const selectedFormat = format.value;
		// 大きなランタイムは操作された時点で読み込み、通常のエディタ起動に含めない。
		const { default: runtime } = await import('virtual:visual-module-embed-runtime');
		if (lifetime.signal.aborted) return;
		const artwork = await encodePortableVisualModule(snapshot);
		if (lifetime.signal.aborted) return;
		const files = createPortableVisualModuleFiles(artwork, runtime);
		const blob = selectedFormat === 'html' ? new Blob([files.standaloneHtml], { type: 'text/html;charset=utf-8' }) : createPortableVisualModuleArchive(files);
		const url = URL.createObjectURL(blob);
		const link = window.document.createElement('a');
		link.href = url;
		link.download = `${artwork.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'visual-module'}.${selectedFormat}`;
		try { link.click(); } finally { window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
		modal.value?.close();
	} catch (error) { exportError.value = error instanceof Error ? error.message : String(error); } finally { exporting.value = false; releaseActivity?.(); }
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
