<template>
<GsModal ref="modal" preferType="dialog" @closed="emit('closed')" @esc="modal?.close()">
	<div :class="$style.root" class="_gaps_m" @keydown.stop>
		<b>{{ i18n.ts._Settings.Title }}</b>
		<section class="_gaps_m">
			<b>{{ i18n.ts._Settings.Rendering }}</b>
			<GsSwitch v-model="enable32bitDataTextures">
				{{ i18n.ts._Settings.Use32bitDataTextures }}
				<template #caption>{{ i18n.ts._Settings.DataTexturesHint }}</template>
			</GsSwitch>
			<GsSelect v-model="intermediateTextureFormat" :items="[
				{ value: null, label: i18n.ts._Settings.AutoTextureFormat },
				{ value: 'rgba8unorm', label: 'rgba8unorm' },
				{ value: 'bgra8unorm', label: 'bgra8unorm' },
				{ value: 'rgba16float', label: 'rgba16float' },
			] as const">
				<template #label>{{ i18n.ts._Settings.IntermediateTextureFormat }}</template>
				<template #caption>{{ i18n.ts._Settings.IntermediateTextureFormatHint }}</template>
			</GsSelect>
		</section>
		<b>{{ i18n.ts._ProjectBackups.Title }}</b>
		<div>{{ i18n.ts._ProjectBackups.Description }}</div>
		<section class="_gaps_m">
			<GsSwitch v-model="settings.autoEnabled">{{ i18n.ts._ProjectBackups.Automatic }}</GsSwitch>
			<div class="_gaps_m" :inert="!settings.autoEnabled">
				<GsInput v-model="settings.autoIntervalMinutes" type="number" :min="1" :step="1"><template #label>{{ i18n.ts._ProjectBackups.Interval }}</template><template #suffix>{{ i18n.ts._ProjectBackups.Minutes }}</template><template #caption>{{ i18n.ts._ProjectBackups.AutomaticHint }}</template></GsInput>
				<GsInput v-model="settings.autoRetentionDays" type="number" :min="1" :step="1"><template #label>{{ i18n.ts._ProjectBackups.AutoRetention }}</template><template #suffix>{{ i18n.ts._ProjectBackups.Days }}</template></GsInput>
			</div>
			<div>{{ i18n.ts._ProjectBackups.LastAutomatic }} {{ formatTime(projectBackupStatus.lastAutoBackup) }}</div>
		</section>
		<section class="_gaps_m">
			<GsSwitch v-model="settings.saveEnabled">{{ i18n.ts._ProjectBackups.BeforeOverwrite }}</GsSwitch>
			<GsInput v-model="settings.saveRetentionDays" type="number" :min="1" :step="1" :disabled="!settings.saveEnabled"><template #label>{{ i18n.ts._ProjectBackups.SaveRetention }}</template><template #suffix>{{ i18n.ts._ProjectBackups.Days }}</template><template #caption>{{ i18n.ts._ProjectBackups.SaveHint }}</template></GsInput>
			<div>{{ i18n.ts._ProjectBackups.LastSave }} {{ formatTime(projectBackupStatus.lastSaveBackup) }}</div>
		</section>
		<div v-if="projectBackupAccess === 'unsaved'">{{ i18n.ts._ProjectBackups.SaveFirst }}</div>
		<GsButton v-else-if="projectBackupAccess === 'folder-required' || projectBackupStatus.error" @click="appContext.grantProjectBackupAccess()">{{ i18n.ts._ProjectBackups.AllowAccess }}</GsButton>
		<div v-else>{{ i18n.ts._ProjectBackups.Ready }}</div>
		<div v-if="projectBackupStatus.error" role="alert">{{ projectBackupStatus.error }}</div>
		<div>{{ i18n.ts._ProjectBackups.RetentionHint }}</div>
		<div v-if="validationError" role="alert">{{ validationError }}</div>
		<div :class="$style.actions">
			<GsButton inline @click="modal?.close()">{{ i18n.ts.Cancel }}</GsButton>
			<GsButton inline primary :disabled="validationError != null" @click="apply">{{ i18n.ts.Apply }}</GsButton>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.ts';
import { appContext } from '@/app.ts';
import { computed, ref, useTemplateRef } from 'vue';
import GsModal from './common/GsModal.vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import GsSwitch from './common/GsSwitch.vue';
import { preferences } from '@/preferences.ts';
import { validateProjectBackupSettings } from '@/project-backups.ts';

const { projectBackupAccess, projectBackupStatus } = appContext;

const modal = useTemplateRef('modal');
const settings = ref({ ...preferences.s.projectBackups });
const enable32bitDataTextures = ref(preferences.s.enable32bitDataTextures);
const intermediateTextureFormat = ref(preferences.s.intermediateTextureFormat);
const validationError = computed(() => {
	try { validateProjectBackupSettings(settings.value); return null; } catch (error) { return error instanceof Error ? error.message : String(error); }
});

function formatTime(value: number | null) { return value == null ? i18n.ts._ProjectBackups.NoneThisSession : new Date(value).toLocaleString(); }

function apply() {
	if (validationError.value) return;
	preferences.commit('projectBackups', { ...settings.value });
	preferences.commit('enable32bitDataTextures', enable32bitDataTextures.value);
	preferences.commit('intermediateTextureFormat', intermediateTextureFormat.value);
	modal.value?.close();
}

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

</script>

<style module lang="scss">
.root {
	margin: auto;
	position: relative;
	padding: 32px;
	width: 480px;
	max-width: 90vw;
	max-height: 85vh;
	overflow-y: auto;
	box-sizing: border-box;
	background: var(--THEME-dialog);
	border-radius: 10px;
}

.actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
}
</style>
