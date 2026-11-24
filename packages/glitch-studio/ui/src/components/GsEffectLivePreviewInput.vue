<template>
<div :class="$style.root">
	<GsSelect
		data-test-effect-preview-input
		:modelValue="sourceKind"
		:items="sourceKinds"
		@update:modelValue="selectKind"
	>
		<template #label>{{ i18n.ts._EffectPreview.Input }}</template>
	</GsSelect>
	<GsButton
		v-if="sourceKind === 'asset'"
		data-test-effect-preview-select-asset
		@click="chooseAsset"
	>
		{{ selectedAsset?.name ?? i18n.ts._Assets.Select }}
	</GsButton>
	<GsPreviewDeviceSelect
		v-if="selection?.kind === 'webcam' || selection?.kind === 'microphone'"
		:key="`${effectSource.type}:${effectSource.id}:${selection.kind}`"
		:kind="selection.kind"
		:deviceId="selection.deviceId"
		:deviceRevision="active ? controller.previewDeviceRevision.value : 0"
		@update:deviceId="selectDevice"
	/>
	<div v-if="hasPlayback" :class="$style.playback">
		<span>{{ i18n.ts._EffectPreview.InputPlayback }}</span>
		<GsVideoControls
			:video="active ? controller.previewMediaElement.value : null"
			:play="() => controller.playPreviewMedia()"
		/>
	</div>
	<GsSwitch
		v-if="hasLiveAudioSource"
		data-test-effect-preview-monitor-audio
		:modelValue="active && controller.livePreviewAudioMonitoringEnabled.value"
		:disabled="!active || !controller.livePreviewAudioMonitoringAvailable.value"
		@update:modelValue="controller.setLivePreviewAudioMonitoringEnabled($event)"
	>
		<template #label>{{ i18n.ts._EffectPreview.MonitorInputAudio }}</template>
	</GsSwitch>
	<div v-if="active && controller.previewMediaError.value != null" :class="$style.error">
		{{ controller.previewMediaError.value }}
	</div>
</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import GsButton from './common/GsButton.vue';
import GsSelect from './common/GsSelect.vue';
import GsSwitch from './common/GsSwitch.vue';
import GsVideoControls from './common/GsVideoControls.vue';
import GsPreviewDeviceSelect from './GsPreviewDeviceSelect.vue';
import { useProjectSession } from '@/project-session.ts';
import { i18n } from '@/i18n.ts';
import { selectAsset } from '@/ui.ts';
import type { EffectLivePreviewMediaSelection, EffectLivePreviewSource } from '@/types/effect-live-preview.ts';

const props = defineProps<{ effectSource: EffectLivePreviewSource }>();
const emit = defineEmits<{ activate: [] }>();
const session = useProjectSession();
const controller = session.effectLivePreviewManagerController;
const assets = session.projectContext.stateManager.state.assets;
const selection = computed(() => session.getEffectLivePreviewMediaSelection(props.effectSource));
const sourceKind = computed(() => selection.value?.kind ?? null);
const supportsAudioParameters = computed(() => props.effectSource.type === 'nodesEffectReference');
const selectedAsset = computed(() => {
	const current = selection.value;
	return current?.kind === 'asset' ? assets.value.find(asset => asset.id === current.assetId) ?? null : null;
});
const sourceKinds = computed(() => [
	{ value: null, label: i18n.ts.None },
	{ value: 'asset' as const, label: i18n.ts.Asset },
	{ value: 'webcam' as const, label: i18n.ts._Webcam.Title },
	{ value: 'microphone' as const, label: i18n.ts._EffectPreview.Microphone },
]);
const active = computed(() => {
	const source = session.previewPlayback.livePreviewEffectSource.value;
	return source?.type === props.effectSource.type && source.id === props.effectSource.id;
});
const hasPlayback = computed(() => /^(video|audio)\//.test(selectedAsset.value?.fileDataType ?? ''));
const hasLiveAudioSource = computed(() => {
	const current = selection.value;
	return (current?.kind === 'microphone' || (current?.kind === 'webcam' && supportsAudioParameters.value)) && current.deviceId != null;
});

function selectKind(kind: EffectLivePreviewMediaSelection['kind'] | null) {
	if (sourceKind.value === kind) return;
	session.setEffectLivePreviewMediaSelection(props.effectSource, kind === 'asset' ? { kind, assetId: null }
		: kind == null ? null
		: { kind, deviceId: null });
}

async function chooseAsset() {
	const initialSelection = selection.value;
	const [asset] = await selectAsset(session, {
		multiple: false,
		mimeType: supportsAudioParameters.value ? ['image/*', 'video/*', 'audio/*'] : ['image/*', 'video/*'],
	});
	if (asset == null || selection.value !== initialSelection) return;
	session.setEffectLivePreviewMediaSelection(props.effectSource, { kind: 'asset', assetId: asset.id });
	if (!active.value) emit('activate');
}

function selectDevice(deviceId: string | null) {
	const kind = sourceKind.value;
	if (kind !== 'webcam' && kind !== 'microphone') return;
	if (selection.value?.kind === kind && selection.value.deviceId === deviceId) return;
	session.setEffectLivePreviewMediaSelection(props.effectSource, { kind, deviceId });
	if (deviceId != null && !active.value) emit('activate');
}
</script>

<style module lang="scss">
.root {
	display: grid;
	gap: 6px;
	padding: 0 10px;
}

.playback {
	display: grid;
	gap: 4px;
}

.error {
	color: var(--THEME-error);
}
</style>
