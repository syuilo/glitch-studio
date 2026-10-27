<template>
<GsModal ref="modal" preferType="dialog" @closed="emit('closed')" @esc="modal?.close()">
	<div :class="$style.root" @keydown.stop>
		<div :class="$style.header">
			<b><i class="ti ti-settings"></i> {{ i18n.ts._Settings.Title }}</b>
			<div style="margin-left: auto;">
				<div v-if="validationError">{{ validationError }}</div>
				<div :class="$style.actions">
					<GsButton icon="ti ti-x" large inline @click="modal?.close()">{{ i18n.ts.Cancel }}</GsButton>
					<GsButton icon="ti ti-check" large inline primary :disabled="validationError != null" data-test-settings-apply @click="apply">{{ i18n.ts.Apply }}</GsButton>
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
								<GsInput v-if="desktopAvailable" v-model="timelineFrameCacheMaxGiB" large type="number" :min="0" :step="0.25" data-test-timeline-frame-cache-capacity>
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
							</div>
						</GsFolder>

						<GsFolder defaultOpen>
							<template #label>{{ i18n.ts.Assets }}</template>

							<div class="_gaps_l">
								<GsSwitch v-model="importAssetsAsExternalReferences" :disabled="!desktopAvailable" data-test-default-external-reference>
									{{ i18n.ts._Assets.DefaultExternalReference }}
								</GsSwitch>
								<GsSwitch v-model="importLargeAssetsAsExternalReferences" :disabled="!desktopAvailable" data-test-large-asset-external-reference>
									{{ i18n.ts._Assets.LargeAssetExternalReference }}
									<template #caption>{{ i18n.ts._Assets.LargeAssetExternalReferenceHint }}</template>
								</GsSwitch>
							</div>
						</GsFolder>

						<GsFolder defaultOpen>
							<template #label>{{ i18n.ts._ProjectBackups.Title }}</template>

							<div class="_gaps_l">
								<GsSwitch v-model="settings.autoEnabled" data-test-backup-auto-enabled>{{ i18n.ts._ProjectBackups.Automatic }}</GsSwitch>
								<div class="_gaps_m" :inert="!settings.autoEnabled">
									<GsInput v-model="settings.autoIntervalMinutes" large type="number" :min="1" :step="1" data-test-backup-auto-interval><template #label>{{ i18n.ts._ProjectBackups.Interval }}</template><template #suffix>{{ i18n.ts._ProjectBackups.Minutes }}</template></GsInput>
									<GsInput v-model="settings.autoRetentionDays" large type="number" :min="1" :step="1" data-test-backup-auto-retention><template #label>{{ i18n.ts._ProjectBackups.Retention }}</template><template #suffix>{{ i18n.ts._ProjectBackups.Days }}</template></GsInput>
								</div>
								<hr>
								<GsSwitch v-model="settings.saveEnabled" data-test-backup-save-enabled>{{ i18n.ts._ProjectBackups.BeforeOverwrite }}</GsSwitch>
								<GsInput v-model="settings.saveRetentionDays" large type="number" :min="1" :step="1" :disabled="!settings.saveEnabled" data-test-backup-save-retention><template #label>{{ i18n.ts._ProjectBackups.Retention }}</template><template #suffix>{{ i18n.ts._ProjectBackups.Days }}</template><template #caption>{{ i18n.ts._ProjectBackups.SaveHint }}</template></GsInput>
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
import { computed, ref, useTemplateRef } from 'vue';
import GsModal from './common/GsModal.vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import GsSwitch from './common/GsSwitch.vue';
import GsFolder from './common/GsFolder.vue';
import { i18n, lang, SUPPORTED_LOCALES } from '@/i18n.ts';
import { changeLocale } from '@/locale-settings-ui.ts';
import { preferences } from '@/preferences.ts';
import { validateProjectBackupSettings } from '@/project-backups.ts';

const modal = useTemplateRef('modal');
const selectedLocale = ref(window.localStorage.getItem('locale') ?? lang);
// 未設定時に表示される既定の言語は、ユーザーが選び直すまでは保存しない。
const initialLocale = selectedLocale.value;
const localeOptions = Object.entries(SUPPORTED_LOCALES).map(([value, label]) => ({ value, label }));
const settings = ref({
	autoEnabled: preferences.s.projectBackupAutoEnabled,
	autoIntervalMinutes: preferences.s.projectBackupAutoIntervalMinutes,
	autoRetentionDays: preferences.s.projectBackupAutoRetentionDays,
	saveEnabled: preferences.s.projectBackupSaveEnabled,
	saveRetentionDays: preferences.s.projectBackupSaveRetentionDays,
});
const desktopAvailable = window.desktop != null;
const importAssetsAsExternalReferences = ref(preferences.s.importAssetsAsExternalReferences);
const importLargeAssetsAsExternalReferences = ref(preferences.s.importLargeAssetsAsExternalReferences);
const enable32bitDataTextures = ref(preferences.s.enable32bitDataTextures);
const intermediateTextureFormat = ref(preferences.s.intermediateTextureFormat);
const timelineFrameCacheMaxGiB = ref(preferences.s.timelineFrameCacheMaxGiB);
const visualModuleAutoConnectOnNodeAdd = ref(preferences.s.visualModuleAutoConnectOnNodeAdd);
const validationError = computed(() => {
	try {
		validateProjectBackupSettings(settings.value);
		if (desktopAvailable && (!Number.isFinite(timelineFrameCacheMaxGiB.value) || timelineFrameCacheMaxGiB.value < 0
			|| !Number.isSafeInteger(Math.floor(timelineFrameCacheMaxGiB.value * 1024 ** 3)))) return i18n.ts._Settings.InvalidFrameCacheCapacity;
		return null;
	} catch (error) { return error instanceof Error ? error.message : String(error); }
});

async function apply() {
	if (validationError.value != null) return;
	// この画面の保持値と同じ項目はcommit()が保存しない。他画面の保存値は比較に使わない。
	preferences.commit('importAssetsAsExternalReferences', importAssetsAsExternalReferences.value);
	preferences.commit('importLargeAssetsAsExternalReferences', importLargeAssetsAsExternalReferences.value);
	preferences.commit('projectBackupAutoEnabled', settings.value.autoEnabled);
	preferences.commit('projectBackupAutoIntervalMinutes', settings.value.autoIntervalMinutes);
	preferences.commit('projectBackupAutoRetentionDays', settings.value.autoRetentionDays);
	preferences.commit('projectBackupSaveEnabled', settings.value.saveEnabled);
	preferences.commit('projectBackupSaveRetentionDays', settings.value.saveRetentionDays);
	preferences.commit('enable32bitDataTextures', enable32bitDataTextures.value);
	preferences.commit('intermediateTextureFormat', intermediateTextureFormat.value);
	if (desktopAvailable) preferences.commit('timelineFrameCacheMaxGiB', timelineFrameCacheMaxGiB.value);
	preferences.commit('visualModuleAutoConnectOnNodeAdd', visualModuleAutoConnectOnNodeAdd.value);
	modal.value?.close();
	if (initialLocale !== selectedLocale.value) await changeLocale(selectedLocale.value);
}

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const tab = ref('general');
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
