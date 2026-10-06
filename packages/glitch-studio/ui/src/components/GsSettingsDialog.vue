<template>
<GsModal ref="modal" preferType="dialog" @closed="emit('closed')" @esc="modal?.close()">
	<div :class="$style.root" class="_gaps_m" @keydown.stop>
		<b>Preferences</b>
		<section class="_gaps_m">
			<b>Rendering</b>
			<GsSwitch v-model="enable32bitDataTextures">
				Use 32-bit data textures
				<template #caption>Stores data and internal calculations in 32-bit float textures instead of 16-bit float textures.</template>
			</GsSwitch>
			<GsSelect v-model="intermediateTextureFormat" :items="[
				{ value: null, label: 'Auto (preferred canvas format)' },
				{ value: 'rgba8unorm', label: 'rgba8unorm' },
				{ value: 'bgra8unorm', label: 'bgra8unorm' },
				{ value: 'rgba16float', label: 'rgba16float' },
			] as const">
				<template #label>Intermediate image texture format</template>
				<template #caption>Controls image output precision and range independently of data texture precision. 16-bit float preserves values outside the 0–1 range and uses more memory than 8-bit formats.</template>
			</GsSelect>
		</section>
		<b>Project backups</b>
		<div>Backups are stored beside the project after its first save. Each backup includes all media.</div>
		<section class="_gaps_m">
			<GsSwitch v-model="settings.autoEnabled">Automatic backups</GsSwitch>
			<div class="_gaps_m" :inert="!settings.autoEnabled">
				<GsInput v-model="settings.autoIntervalMinutes" type="number" :min="1" :step="1"><template #label>Interval</template><template #suffix>minutes</template><template #caption>Creates a backup only when the project has changed since its previous automatic backup.</template></GsInput>
				<GsInput v-model="settings.autoRetentionDays" type="number" :min="1" :step="1"><template #label>Keep automatic backups for</template><template #suffix>days</template></GsInput>
			</div>
			<div>Last automatic backup: {{ formatTime(projectBackupStatus.lastAutoBackup) }}</div>
		</section>
		<section class="_gaps_m">
			<GsSwitch v-model="settings.saveEnabled">Back up before overwriting</GsSwitch>
			<GsInput v-model="settings.saveRetentionDays" type="number" :min="1" :step="1" :disabled="!settings.saveEnabled"><template #label>Keep save backups for</template><template #suffix>days</template><template #caption>Preserves the existing file before Save or Save as replaces it. If the backup fails, the project is not overwritten.</template></GsInput>
			<div>Last save backup: {{ formatTime(projectBackupStatus.lastSaveBackup) }}</div>
		</section>
		<div v-if="projectBackupAccess === 'unsaved'">Save the project once to start backups.</div>
		<GsButton v-else-if="projectBackupAccess === 'folder-required' || projectBackupStatus.error" @click="appContext.grantProjectBackupAccess()">Allow access to project folder</GsButton>
		<div v-else>Backup folder is ready.</div>
		<div v-if="projectBackupStatus.error" role="alert">{{ projectBackupStatus.error }}</div>
		<div>Expired backups are removed while this project is open and the corresponding feature is enabled. The latest successful automatic backup is kept until a newer one succeeds, even after its retention period. Closing or suspending the app pauses backups.</div>
		<div v-if="validationError" role="alert">{{ validationError }}</div>
		<div :class="$style.actions">
			<GsButton inline @click="modal?.close()">Cancel</GsButton>
			<GsButton inline primary :disabled="validationError != null" @click="apply">Apply</GsButton>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
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

function formatTime(value: number | null) { return value == null ? 'None this session' : new Date(value).toLocaleString(); }

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
