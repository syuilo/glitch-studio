<template>
<div :class="$style.root">
	<GsSelect
		data-test-media-player-source
		:modelValue="selection.kind"
		:items="sourceKinds"
		@update:modelValue="selectKind"
	>
		<template #label>{{ i18n.ts._MediaPlayer.Source }}</template>
	</GsSelect>
	<GsButton
		v-if="selection.kind === 'asset'"
		data-test-media-player-select-asset
		@click="chooseAsset"
	>{{ player.selectedAsset.value?.name ?? i18n.ts._Assets.Select }}</GsButton>
	<GsPreviewDeviceSelect
		v-else
		:key="selection.kind"
		:kind="selection.kind"
		:deviceId="selection.deviceId"
		:deviceRevision="player.deviceRevision.value"
		@update:deviceId="selectDevice"
	/>
	<GsSwitch
		v-if="selection.kind === 'webcam'"
		v-model="player.captureWebcamAudio.value"
		:disabled="player.captureStatus.value !== 'idle'"
	>
		<template #label>{{ i18n.ts._MediaPlayer.CaptureWebcamAudio }}</template>
	</GsSwitch>
	<GsButton
		v-if="!player.active.value"
		primary
		data-test-media-player-activate
		@click="session.previewPlayback.showMediaPlayer()"
	>{{ i18n.ts._MediaPlayer.ShowPreview }}</GsButton>
	<GsVideoControls
		v-else-if="player.mediaElement.value != null"
		:video="player.mediaElement.value"
		:play="() => player.playFile()"
	/>
	<template v-else-if="selection.kind !== 'asset'">
		<GsButton
			v-if="player.captureStatus.value === 'idle'"
			primary
			:disabled="selection.deviceId == null"
			data-test-media-player-start-capture
			@click="player.startCapture()"
		>{{ i18n.ts.Start }}</GsButton>
		<GsButton
			v-else
			data-test-media-player-stop-capture
			@click="player.stopCapture()"
		>{{ i18n.ts._VideoControls.Stop }}</GsButton>
		<div v-if="player.captureStatus.value === 'connecting'">{{ i18n.ts._MediaPlayer.Connecting }}</div>
		<GsSwitch
			v-if="player.monitoringAvailable.value"
			:modelValue="player.monitoringEnabled.value"
			data-test-media-player-monitor-audio
			@update:modelValue="player.setMonitoringEnabled($event)"
		>
			<template #label>{{ i18n.ts._EffectPreview.MonitorInputAudio }}</template>
		</GsSwitch>
		<div v-if="captureSettings.length > 0" :class="$style.captureSettings">
			<div v-for="setting in captureSettings" :key="setting.label">
				{{ setting.label }} <span>{{ setting.active ? i18n.ts.On : i18n.ts.Off }}</span>
			</div>
		</div>
	</template>
	<div v-if="error != null" :class="$style.error">{{ error }}</div>
</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { i18n } from '@/i18n.ts';
import { useProjectSession } from '@/project-session.ts';
import { selectAsset } from '@/ui.ts';
import { defaultPreviewDeviceId } from '@/utility/preview-device.ts';
import type { MediaPlayerSelection } from '@/MediaPlayerController.ts';
import GsButton from './common/GsButton.vue';
import GsSelect from './common/GsSelect.vue';
import GsSwitch from './common/GsSwitch.vue';
import GsVideoControls from './common/GsVideoControls.vue';
import GsPreviewDeviceSelect from './GsPreviewDeviceSelect.vue';

const session = useProjectSession();
const player = session.mediaPlayer;
const selection = player.selection;
const error = computed(() => player.errorMessage.value ?? player.renderer.errorMessage.value);
const sourceKinds = computed(() => [
	{ value: 'asset' as const, label: i18n.ts.Asset },
	{ value: 'webcam' as const, label: i18n.ts._Webcam.Title },
	{ value: 'microphone' as const, label: i18n.ts._EffectPreview.Microphone },
]);
const captureSettings = computed(() => {
	const settings = player.audioCaptureSettings.value;
	if (settings == null) return [];
	return [
		{ label: i18n.ts._MediaPlayer.EchoCancellation, active: settings.echoCancellation },
		{ label: i18n.ts._MediaPlayer.AutoGainControl, active: settings.autoGainControl },
		{ label: i18n.ts._MediaPlayer.NoiseSuppression, active: settings.noiseSuppression },
	].filter(setting => setting.active != null);
});

function selectKind(kind: MediaPlayerSelection['kind']) {
	if (selection.value.kind === kind) return;
	player.setSelection(kind === 'asset' ? { kind, assetId: null } : { kind, deviceId: defaultPreviewDeviceId });
}

async function chooseAsset() {
	const originalSelection = selection.value;
	const [asset] = await selectAsset(session, { multiple: false, mimeType: ['image/*', 'video/*', 'audio/*'] });
	if (asset == null || session.isDisposed || selection.value !== originalSelection) return;
	player.setSelection({ kind: 'asset', assetId: asset.id });
}

function selectDevice(deviceId: string | null) {
	const current = selection.value;
	if (current.kind !== 'asset' && current.deviceId !== deviceId) player.setSelection({ kind: current.kind, deviceId });
}
</script>

<style module lang="scss">
.root {
	display: grid;
	align-content: start;
	gap: 8px;
	padding: 8px 10px;
	overflow: auto;
}

.captureSettings {
	display: grid;
	gap: 4px;
	opacity: 0.8;
}

.error {
	color: var(--THEME-error);
}
</style>
