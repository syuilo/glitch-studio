<template>
<div :class="$style.root">
	<GsSelect
		data-test-effect-preview-resolution-mode
		:modelValue="mode"
		:items="modes"
		@update:modelValue="selectMode"
	>
		<template #label>{{ i18n.ts._EffectPreview.Resolution }}</template>
		<template v-if="mode === 'project'" #caption>{{ projectPreviewResolution.width }} × {{ projectPreviewResolution.height }} px</template>
	</GsSelect>
	<template v-if="mode === 'custom'">
		<div :class="$style.dimensions">
			<GsInput
				v-model="width"
				data-test-effect-preview-resolution-width
				type="number"
				:min="1"
				:step="1"
				@enter="apply"
			>
				<template #label>{{ i18n.ts.Width }}</template>
				<template #suffix>px</template>
			</GsInput>
			<GsInput
				v-model="height"
				data-test-effect-preview-resolution-height
				type="number"
				:min="1"
				:step="1"
				@enter="apply"
			>
				<template #label>{{ i18n.ts.Height }}</template>
				<template #suffix>px</template>
			</GsInput>
		</div>
		<div v-if="!isValid" :class="$style.error">{{ i18n.ts._Project.InvalidResolution }}</div>
		<GsButton
			data-test-effect-preview-resolution-apply
			inline
			:disabled="!canApply"
			@click="apply"
		>{{ i18n.ts.Apply }}</GsButton>
	</template>
</div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { scaleResolution } from '@gs/shared/resolution.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import { i18n } from '@/i18n.ts';
import { useProjectSession } from '@/project-session.ts';
import type { EffectLivePreviewSource } from '@/types/effect-live-preview.ts';

type Mode = 'project' | 'custom';

const props = defineProps<{ effectSource: EffectLivePreviewSource }>();
const emit = defineEmits<{ activate: [] }>();
const session = useProjectSession();
const projectPreviewResolution = computed(() => scaleResolution(session.projectContext.stateManager.state.resolution.value, session.resolutionFactor.value));
const customResolution = computed(() => session.getEffectLivePreviewCustomResolution(props.effectSource));
const modes = computed(() => [
	{ value: 'project' as const, label: i18n.ts._EffectPreview.FollowProjectResolution },
	{ value: 'custom' as const, label: i18n.ts._EffectPreview.CustomResolution },
]);
const mode = ref<Mode>('project');
const width = ref(0);
const height = ref(0);
const isValid = computed(() => [width.value, height.value].every(value => Number.isSafeInteger(value) && value > 0));
const canApply = computed(() => isValid.value && (customResolution.value?.width !== width.value || customResolution.value?.height !== height.value));

watch(customResolution, resolution => {
	mode.value = resolution == null ? 'project' : 'custom';
	const dimensions = resolution ?? projectPreviewResolution.value;
	width.value = dimensions.width;
	height.value = dimensions.height;
}, { immediate: true });

function selectMode(nextMode: Mode) {
	if (nextMode === mode.value) return;
	mode.value = nextMode;
	if (nextMode === 'project') {
		if (customResolution.value != null) applyResolution(null);
	} else {
		width.value = projectPreviewResolution.value.width;
		height.value = projectPreviewResolution.value.height;
	}
}

function apply() {
	if (!canApply.value) return;
	applyResolution({ width: width.value, height: height.value });
}

function applyResolution(resolution: Resolution | null) {
	session.setEffectLivePreviewCustomResolution(props.effectSource, resolution);
	const activeSource = session.previewPlayback.livePreviewEffectSource.value;
	if (activeSource?.type !== props.effectSource.type || activeSource.id !== props.effectSource.id) emit('activate');
}
</script>

<style module lang="scss">
.root {
	display: grid;
	gap: 6px;
	padding: 0 10px;
}

.dimensions {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 6px;
}

.error {
	color: var(--THEME-error);
}
</style>
