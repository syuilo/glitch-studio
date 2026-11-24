<template>
<GsRange
	v-model="effectLivePreviewTimeFactor"
	:class="$style.root"
	data-test-effect-preview-time-factor
	:min="-8"
	:max="8"
	:step="0.1"
	continuousUpdate
>
	<template #label>{{ i18n.ts._EffectPreview.TimeFactor }}</template>
	<template #suffix>×</template>
</GsRange>
</template>

<script setup lang="ts">
import GsRange from './common/GsRange.vue';
import { i18n } from '@/i18n.ts';
import { useProjectSession } from '@/project-session.ts';

const { effectLivePreviewTimeFactor } = useProjectSession();
</script>

<style module lang="scss">
.root {
	padding: 4px 10px;
}
</style>
