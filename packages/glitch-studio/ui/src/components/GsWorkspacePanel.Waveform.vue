<template>
<div :class="$style.root">
	<GsWaveform :key="panel.contentType" :direction="verticalPosition ? 'vertical' : 'horizontal'"/>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import type { WorkspacePanel } from '@/workspace.ts';
import GsWaveform from '@/components/GsWaveform.vue';

const props = defineProps<{
	panel: WorkspacePanel;
}>();

// WorkspacePanelのcontentTypeはこのコンポーネントを含むパネル定義から導出されるため、
// 戻り値を明示してコンポーネントとパネル定義の型推論が循環するのを防ぐ。
const verticalPosition: ComputedRef<boolean> = computed((): boolean => props.panel.contentType === 'waveformVertical');
</script>

<style module lang="scss">
.root {
	height: 100%;
	padding: 2px 8px 8px 8px;
	box-sizing: border-box;
}
</style>
