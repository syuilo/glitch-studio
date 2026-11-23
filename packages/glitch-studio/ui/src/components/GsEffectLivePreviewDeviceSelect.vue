<template>
<GsSelect
	data-test-effect-preview-device
	:modelValue="deviceId"
	:items="deviceOptions"
	:disabled="mediaDevices == null || requestingAccess"
	@update:modelValue="emit('update:deviceId', $event)"
>
	<template #label>{{ kind === 'webcam' ? i18n.ts._Webcam.Title : i18n.ts._EffectPreview.Microphone }}</template>
</GsSelect>
<GsButton
	v-if="mediaDevices != null && availableDevices?.length === 0"
	data-test-effect-preview-device-access
	:disabled="requestingAccess"
	@click="requestDeviceAccess"
>
	{{ i18n.ts._EffectPreview.AllowDeviceAccess }}
</GsButton>
<div v-if="deviceError != null" :class="$style.error">{{ deviceError }}</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import GsButton from './common/GsButton.vue';
import GsSelect from './common/GsSelect.vue';
import { defaultPreviewDeviceId } from '@/types/effect-live-preview.ts';
import { i18n } from '@/i18n.ts';

const props = defineProps<{ kind: 'webcam' | 'microphone'; deviceId: string | null; deviceRevision: number }>();
const emit = defineEmits<{ 'update:deviceId': [deviceId: string | null] }>();
const mediaDevices = navigator.mediaDevices ?? null;
const lifetime = new AbortController();
const availableDevices = shallowRef<MediaDeviceInfo[] | null>(null);
const requestingAccess = ref(false);
const deviceError = ref<string | null>(mediaDevices == null ? i18n.ts._EffectPreview.DeviceUnavailable : null);
let listRequest = 0;

const deviceOptions = computed(() => {
	const options = [
		{ value: null, label: i18n.ts._EffectPreview.DeviceUnselected },
		{ value: defaultPreviewDeviceId, label: i18n.ts._EffectPreview.DefaultDevice },
		...(availableDevices.value ?? []).map((device, index) => ({
			value: device.deviceId,
			label: device.label || `${i18n.ts._EffectPreview.UnnamedDevice} ${index + 1}`,
		})),
	];
	const deviceId = props.deviceId;
	if (deviceId != null && !options.some(option => option.value === deviceId)) {
		options.push({ value: deviceId, label: i18n.ts._EffectPreview.DeviceUnavailable });
	}
	return options;
});

async function refreshDevices() {
	if (mediaDevices == null) return;
	const request = ++listRequest;
	try {
		const devices = await mediaDevices.enumerateDevices();
		if (lifetime.signal.aborted || request !== listRequest) return;
		const deviceKind = props.kind === 'webcam' ? 'videoinput' : 'audioinput';
		availableDevices.value = devices.filter(device => device.kind === deviceKind && device.deviceId !== '' && device.deviceId !== defaultPreviewDeviceId);
		if (availableDevices.value.length > 0) deviceError.value = null;
	} catch {
		if (lifetime.signal.aborted || request !== listRequest) return;
		availableDevices.value ??= [];
		deviceError.value = i18n.ts._EffectPreview.DeviceListFailed;
	}
}

async function requestDeviceAccess() {
	if (mediaDevices == null || requestingAccess.value) return;
	requestingAccess.value = true;
	deviceError.value = null;
	try {
		const isWebcam = props.kind === 'webcam';
		const stream = await mediaDevices.getUserMedia({ video: isWebcam, audio: !isWebcam });
		const stopTracks = () => { for (const track of stream.getTracks()) track.stop(); };
		// 機器名の取得だけに使い、列挙が終わるか選択欄を離れたらすぐに解放する。
		try {
			if (lifetime.signal.aborted) return;
			lifetime.signal.addEventListener('abort', stopTracks, { once: true });
			await refreshDevices();
		} finally {
			lifetime.signal.removeEventListener('abort', stopTracks);
			stopTracks();
		}
	} catch {
		if (!lifetime.signal.aborted) deviceError.value = i18n.ts._EffectPreview.DeviceAccessFailed;
	} finally {
		if (!lifetime.signal.aborted) requestingAccess.value = false;
	}
}

onMounted(() => {
	mediaDevices?.addEventListener('devicechange', refreshDevices, { signal: lifetime.signal });
	void refreshDevices();
});
watch(() => props.deviceRevision, refreshDevices);
onBeforeUnmount(() => lifetime.abort());
</script>

<style module lang="scss">
.error {
	color: var(--THEME-error);
}
</style>
