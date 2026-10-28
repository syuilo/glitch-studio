<template>
<GsModal ref="modal" preferType="dialog" @closed="emit('closed')" @esc="modal?.close()">
	<div :class="$style.root" @keydown.stop>
		<div :class="$style.header">
			<b><i class="ti ti-settings"></i> {{ i18n.ts._Settings.Title }}</b>
			<div style="margin-left: auto;">
				<div :class="$style.actions">
					<GsButton icon="ti ti-x" large inline @click="modal?.close()">{{ i18n.ts.Close }}</GsButton>
				</div>
			</div>
		</div>

		<div :class="$style.body">
			<div :class="$style.nav">
			</div>
			<div :class="$style.contents">
				<div class="_spacer _gaps_l">
					<template v-if="tab === 'general'">
						<GsSelect v-model="selectedLocale" large :items="localeOptions" data-test-language>
							<template #label>{{ i18n.ts._Settings.Language }}</template>
							<template #caption>{{ i18n.ts.LocaleChangedDescription }}</template>
						</GsSelect>

						<GsFolder defaultOpen>
							<template #label>{{ i18n.ts._Workspace.VisualModuleEditor }}</template>

							<GsSwitch v-model="visualModuleAutoConnectOnNodeAdd" data-test-visual-module-auto-connect-on-node-add>
								{{ i18n.ts._Settings.VisualModuleAutoConnectOnNodeAdd }}
								<template #caption>{{ i18n.ts._Settings.VisualModuleAutoConnectOnNodeAddHint }}</template>
							</GsSwitch>
						</GsFolder>

						<GsFolder defaultOpen>
							<template #label>{{ i18n.ts._Settings.Rendering }}</template>

							<div class="_gaps_l">
								<GsInput v-model="timelineFrameCacheMaxGiB" manualSave large type="number" :min="0" :step="0.25" data-test-timeline-frame-cache-capacity>
									<template #label>{{ i18n.ts._Settings.TimelineFrameCacheCapacity }}</template>
									<template #suffix>GiB</template>
									<template #caption>{{ i18n.ts._Settings.TimelineFrameCacheCapacityHint }}</template>
								</GsInput>
								<GsSwitch v-model="enable32bitDataTextures">
									{{ i18n.ts._Settings.Use32bitDataTextures }}
									<template #caption>{{ i18n.ts._Settings.DataTexturesHint }}</template>
								</GsSwitch>
								<GsSelect
									v-model="intermediateTextureFormat" large :items="[
										{ value: null, label: i18n.ts._Settings.AutoTextureFormat },
										{ value: 'rgba8unorm', label: 'rgba8unorm' },
										{ value: 'bgra8unorm', label: 'bgra8unorm' },
										{ value: 'rgba16float', label: 'rgba16float' },
									] as const"
								>
									<template #label>{{ i18n.ts._Settings.IntermediateTextureFormat }}</template>
									<template #caption>{{ i18n.ts._Settings.IntermediateTextureFormatHint }}</template>
								</GsSelect>
								<GsSelect v-model="timelinePreviewFramesAhead" large :items="[0, 1, 2, 3].map(value => ({ value, label: String(value) }))" data-test-timeline-preview-frames-ahead>
									<template #label>{{ i18n.ts._Settings.TimelinePreviewFramesAhead }}</template>
									<template #caption>{{ i18n.ts._Settings.TimelinePreviewFramesAheadHint }}</template>
								</GsSelect>
								<GsSelect
									v-model="previewDisplayMode" large :items="[
										{ value: 'gpu', label: i18n.ts._Settings.PreviewDisplayGpu },
										{ value: 'cpu', label: i18n.ts._Settings.PreviewDisplayCpu },
									]" data-test-preview-display-mode
								>
									<template #label>{{ i18n.ts._Settings.PreviewDisplayMode }}</template>
									<template #caption>{{ i18n.ts._Settings.PreviewDisplayModeHint }}</template>
								</GsSelect>
							</div>
						</GsFolder>

						<GsFolder defaultOpen>
							<template #label>{{ i18n.ts.Assets }}</template>

							<div class="_gaps_l">
								<GsSwitch v-model="importAssetsAsExternalReferences" :disabled="!isElectron" data-test-default-external-reference>
									{{ i18n.ts._Assets.DefaultExternalReference }}
								</GsSwitch>
								<GsSwitch v-model="importLargeAssetsAsExternalReferences" :disabled="!isElectron" data-test-large-asset-external-reference>
									{{ i18n.ts._Assets.LargeAssetExternalReference }}
									<template #caption>{{ i18n.ts._Assets.LargeAssetExternalReferenceHint }}</template>
								</GsSwitch>
							</div>
						</GsFolder>

						<GsFolder defaultOpen>
							<template #label>{{ i18n.ts._ProjectBackups.Title }}</template>

							<div class="_gaps_l">
								<GsSwitch v-model="projectBackupAutoEnabled" data-test-backup-auto-enabled>{{ i18n.ts._ProjectBackups.Automatic }}</GsSwitch>
								<div class="_gaps_m" :inert="!projectBackupAutoEnabled">
									<GsInput v-model="projectBackupAutoIntervalMinutes" manualSave large type="number" :min="1" :step="1" data-test-backup-auto-interval><template #label>{{ i18n.ts._ProjectBackups.Interval }}</template><template #suffix>{{ i18n.ts._ProjectBackups.Minutes }}</template></GsInput>
									<GsInput v-model="projectBackupAutoRetentionDays" manualSave large type="number" :min="1" :step="1" data-test-backup-auto-retention><template #label>{{ i18n.ts._ProjectBackups.Retention }}</template><template #suffix>{{ i18n.ts._ProjectBackups.Days }}</template></GsInput>
								</div>
								<hr>
								<GsSwitch v-model="projectBackupSaveEnabled" data-test-backup-save-enabled>{{ i18n.ts._ProjectBackups.BeforeOverwrite }}</GsSwitch>
								<GsInput v-model="projectBackupSaveRetentionDays" manualSave large type="number" :min="1" :step="1" :disabled="!projectBackupSaveEnabled" data-test-backup-save-retention><template #label>{{ i18n.ts._ProjectBackups.Retention }}</template><template #suffix>{{ i18n.ts._ProjectBackups.Days }}</template><template #caption>{{ i18n.ts._ProjectBackups.SaveHint }}</template></GsInput>
							</div>
						</GsFolder>
					</template>
				</div>
			</div>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { ref, useTemplateRef, watch } from 'vue';
import GsModal from './common/GsModal.vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import GsSwitch from './common/GsSwitch.vue';
import GsFolder from './common/GsFolder.vue';
import { i18n, lang, SUPPORTED_LOCALES } from '@/i18n.ts';
import { changeLocale } from '@/locale-settings-ui.ts';
import { preferences } from '@/preferences.ts';

const isElectron = __ELECTRON__;

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const modal = useTemplateRef('modal');
const tab = ref('general');
const selectedLocale = ref(window.localStorage.getItem('locale') ?? lang);
const localeOptions = Object.entries(SUPPORTED_LOCALES).map(([value, label]) => ({ value, label }));
watch(selectedLocale, locale => changeLocale(locale));

const projectBackupAutoEnabled = preferences.model('projectBackupAutoEnabled');
const projectBackupAutoIntervalMinutes = preferences.model('projectBackupAutoIntervalMinutes');
const projectBackupAutoRetentionDays = preferences.model('projectBackupAutoRetentionDays');
const projectBackupSaveEnabled = preferences.model('projectBackupSaveEnabled');
const projectBackupSaveRetentionDays = preferences.model('projectBackupSaveRetentionDays');
const importAssetsAsExternalReferences = preferences.model('importAssetsAsExternalReferences');
const importLargeAssetsAsExternalReferences = preferences.model('importLargeAssetsAsExternalReferences');
const enable32bitDataTextures = preferences.model('enable32bitDataTextures');
const intermediateTextureFormat = preferences.model('intermediateTextureFormat');
const timelineFrameCacheMaxGiB = preferences.model('timelineFrameCacheMaxGiB');
const timelinePreviewFramesAhead = preferences.model('timelinePreviewFramesAhead');
const previewDisplayMode = preferences.model('previewDisplayMode');
const visualModuleAutoConnectOnNodeAdd = preferences.model('visualModuleAutoConnectOnNodeAdd');
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	margin: auto;
	position: relative;
	width: 900px;
	height: 100%;
	box-sizing: border-box;
	background: var(--THEME-dialog);
	border-radius: 10px;
	overflow: clip;
}

.header {
	--height: 40px;
	line-height: var(--height);
	font-size: 110%;
	padding-left: 10px;
	display: flex;
	align-items: center;
	border-bottom: solid 1px #fff2;
}

.body {
	flex: 1;
	display: flex;
	flex-direction: row;
	min-height: 0;
}

.nav {
	width: 250px;
	flex-shrink: 0;
	border-right: solid 1px #fff2;
	overflow: auto;
}

.contents {
	flex: 1;
	min-width: 0;
	height: 100%;
	overflow: clip;
	overflow-y: auto;
}

.actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
}
</style>
