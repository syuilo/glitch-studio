<template>
<GsModal ref="modal" preferType="dialog" @closed="emit('closed')" @esc="modal?.close()">
	<div :class="$style.root" @keydown.stop>
		<div :class="$style.header">
			<b><i class="ti ti-settings"></i> {{ i18n.ts._Settings.Title }}</b>
			<div style="margin-left: auto;">
				<div v-if="validationError" role="alert">{{ validationError }}</div>
				<div :class="$style.actions">
					<GsButton icon="ti ti-x" large inline @click="modal?.close()">{{ i18n.ts.Cancel }}</GsButton>
					<GsButton icon="ti ti-check" large inline primary :disabled="validationError != null" @click="apply">{{ i18n.ts.Apply }}</GsButton>
				</div>
			</div>
		</div>

		<div :class="$style.body">
			<div :class="$style.nav">
			</div>
			<div :class="$style.contents">
				<div class="_spacer _gaps_l">
					<template v-if="tab === 'general'">
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
								<GsSwitch v-model="settings.autoEnabled">{{ i18n.ts._ProjectBackups.Automatic }}</GsSwitch>
								<div class="_gaps_m" :inert="!settings.autoEnabled">
									<GsInput v-model="settings.autoIntervalMinutes" large type="number" :min="1" :step="1"><template #label>{{ i18n.ts._ProjectBackups.Interval }}</template><template #suffix>{{ i18n.ts._ProjectBackups.Minutes }}</template></GsInput>
									<GsInput v-model="settings.autoRetentionDays" large type="number" :min="1" :step="1"><template #label>{{ i18n.ts._ProjectBackups.Retention }}</template><template #suffix>{{ i18n.ts._ProjectBackups.Days }}</template></GsInput>
								</div>
								<hr>
								<GsSwitch v-model="settings.saveEnabled">{{ i18n.ts._ProjectBackups.BeforeOverwrite }}</GsSwitch>
								<GsInput v-model="settings.saveRetentionDays" large type="number" :min="1" :step="1" :disabled="!settings.saveEnabled"><template #label>{{ i18n.ts._ProjectBackups.Retention }}</template><template #suffix>{{ i18n.ts._ProjectBackups.Days }}</template><template #caption>{{ i18n.ts._ProjectBackups.SaveHint }}</template></GsInput>
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
import { appContext } from '@/app.ts';
import { i18n } from '@/i18n.ts';
import { preferences } from '@/preferences.ts';
import { validateProjectBackupSettings } from '@/project-backups.ts';

const { projectBackupAccess, projectBackupStatus } = appContext;

const modal = useTemplateRef('modal');
const settings = ref({ ...preferences.s.projectBackups });
const desktopAvailable = window.desktop != null;
const importAssetsAsExternalReferences = ref(preferences.s.importAssetsAsExternalReferences);
const importLargeAssetsAsExternalReferences = ref(preferences.s.importLargeAssetsAsExternalReferences);
const enable32bitDataTextures = ref(preferences.s.enable32bitDataTextures);
const intermediateTextureFormat = ref(preferences.s.intermediateTextureFormat);
const visualModuleAutoConnectOnNodeAdd = ref(preferences.s.visualModuleAutoConnectOnNodeAdd);
const validationError = computed(() => {
	try { validateProjectBackupSettings(settings.value); return null; } catch (error) { return error instanceof Error ? error.message : String(error); }
});

function apply() {
	if (validationError.value) return;
	preferences.commit('importAssetsAsExternalReferences', importAssetsAsExternalReferences.value);
	preferences.commit('importLargeAssetsAsExternalReferences', importLargeAssetsAsExternalReferences.value);
	preferences.commit('projectBackups', { ...settings.value });
	preferences.commit('enable32bitDataTextures', enable32bitDataTextures.value);
	preferences.commit('intermediateTextureFormat', intermediateTextureFormat.value);
	preferences.commit('visualModuleAutoConnectOnNodeAdd', visualModuleAutoConnectOnNodeAdd.value);
	modal.value?.close();
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
