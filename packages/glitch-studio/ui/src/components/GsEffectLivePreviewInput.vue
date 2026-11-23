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
	<div v-if="active && controller.previewMediaError.value != null" :class="$style.error">
		{{ controller.previewMediaError.value }}
	</div>
</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import GsSelect from './common/GsSelect.vue';
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
const eligibleAssets = computed(() => assets.value.filter(asset => /^(image|video)\//.test(asset.fileDataType)
	|| (props.effectSource.type === 'customNodeGraphEffectReference' && asset.fileDataType.startsWith('audio/'))));
const selectedAsset = computed(() => {
	const current = selection.value;
	return current?.kind === 'asset' ? eligibleAssets.value.find(asset => asset.id === current.assetId) : null;
});
const items = computed(() => [
	{ value: null, label: i18n.ts.None },
	{ value: 'webcam', label: i18n.ts._Webcam.Title },
	...eligibleAssets.value.map(asset => ({ value: 'asset:' + asset.id, label: asset.name })),
]);
const selectedValue = computed(() => selection.value?.kind === 'webcam' ? 'webcam'
	: selectedAsset.value == null ? null : 'asset:' + selectedAsset.value.id);
const active = computed(() => {
	const source = session.previewPlayback.livePreviewEffectSource.value;
	return source?.type === props.effectSource.type && source.id === props.effectSource.id;
});
const hasPlayback = computed(() => /^(video|audio)\//.test(selectedAsset.value?.fileDataType ?? ''));

function select(value: string | null) {
	session.setEffectLivePreviewMediaSelection(props.effectSource, value === 'webcam' ? { kind: 'webcam' }
		: value == null ? null : { kind: 'asset', assetId: value.slice('asset:'.length) });
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
