<template>
<div :class="$style.root">
	<GsSelect
		data-test-effect-preview-input
		:modelValue="selectedValue"
		:items="items"
		@update:modelValue="select"
	>
		<template #label>{{ i18n.ts._EffectPreview.Input }}</template>
	</GsSelect>
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
import GsSelect from './common/GsSelect.vue';
import GsSwitch from './common/GsSwitch.vue';
import GsVideoControls from './common/GsVideoControls.vue';
import { useProjectSession } from '@/project-session.ts';
import { i18n } from '@/i18n.ts';
import type { EffectLivePreviewSource } from '@/types/effect-live-preview.ts';

const props = defineProps<{ effectSource: EffectLivePreviewSource }>();
const emit = defineEmits<{ activate: [] }>();
const session = useProjectSession();
const controller = session.effectLivePreviewManagerController;
const assets = session.projectContext.stateManager.state.assets;
const selection = computed(() => session.getEffectLivePreviewMediaSelection(props.effectSource));
const supportsAudio = computed(() => props.effectSource.type === 'nodesEffectReference');
const eligibleAssets = computed(() => assets.value.filter(asset => /^(image|video)\//.test(asset.fileDataType)
	|| (supportsAudio.value && asset.fileDataType.startsWith('audio/'))));
const selectedAsset = computed(() => {
	const current = selection.value;
	return current?.kind === 'asset' ? eligibleAssets.value.find(asset => asset.id === current.assetId) : null;
});
const items = computed(() => [
	{ value: null, label: i18n.ts.None },
	{ value: 'webcam', label: i18n.ts._Webcam.Title },
	...(supportsAudio.value ? [{ value: 'microphone', label: i18n.ts._EffectPreview.Microphone }] : []),
	...eligibleAssets.value.map(asset => ({ value: 'asset:' + asset.id, label: asset.name })),
]);
const selectedValue = computed(() => {
	const current = selection.value;
	if (current?.kind === 'webcam' || current?.kind === 'microphone') return current.kind;
	return selectedAsset.value == null ? null : 'asset:' + selectedAsset.value.id;
});
const active = computed(() => {
	const source = session.previewPlayback.livePreviewEffectSource.value;
	return source?.type === props.effectSource.type && source.id === props.effectSource.id;
});
const hasPlayback = computed(() => /^(video|audio)\//.test(selectedAsset.value?.fileDataType ?? ''));
const hasLiveAudioSource = computed(() => supportsAudio.value && (selectedValue.value === 'webcam' || selectedValue.value === 'microphone'));

function select(value: string | null) {
	const selection = value === 'webcam' || value === 'microphone' ? { kind: value } as const
		: value == null ? null : { kind: 'asset' as const, assetId: value.slice('asset:'.length) };
	session.setEffectLivePreviewMediaSelection(props.effectSource, selection);
	if (!active.value && value != null) emit('activate');
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
